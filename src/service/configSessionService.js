// src/service/configSessionService.js
// Configuration Session Service - WhatsApp Configuration Management
// In-memory session store — no DB migrations required

import { logger } from '../utils/logger.js';

// In-memory session store: Map<phoneNumber, sessionObject>
const sessions = new Map();

function generateSessionId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function isExpired(session) {
  return new Date(session.expires_at) < new Date();
}

/**
 * Configuration Session Management Service (in-memory)
 */
export const ConfigSessionService = {
  async createSession(phoneNumber, clientId, {
    timeoutMs = 10 * 60 * 1000,
    originalState = {}
  } = {}) {
    const session = {
      session_id: generateSessionId(),
      phone_number: phoneNumber,
      client_id: clientId || null,
      current_stage: 'selecting_client',
      configuration_group: null,
      pending_changes: {},
      original_state: originalState,
      timeout_extensions: 0,
      expires_at: new Date(Date.now() + timeoutMs),
      created_at: new Date(),
      updated_at: new Date()
    };
    sessions.set(phoneNumber, session);
    logger.info('ConfigSession created in memory:', { phoneNumber, sessionId: session.session_id });
    return session;
  },

  async getActiveSession(phoneNumber) {
    const session = sessions.get(phoneNumber);
    if (!session || isExpired(session)) {
      if (session) sessions.delete(phoneNumber);
      return null;
    }
    return session;
  },

  async getSessionById(sessionId) {
    for (const session of sessions.values()) {
      if (session.session_id === sessionId && !isExpired(session)) {
        return session;
      }
    }
    return null;
  },

  async updateSessionStage(sessionId, newStage, additionalUpdates = {}) {
    for (const [phone, session] of sessions.entries()) {
      if (session.session_id === sessionId) {
        if (newStage && typeof newStage === 'object' && !Array.isArray(newStage)) {
          const { current_stage: currentStage, ...legacyUpdates } = newStage;
          Object.assign(session, {
            current_stage: currentStage ?? session.current_stage,
            ...legacyUpdates,
            updated_at: new Date()
          });
          return session;
        }

        Object.assign(session, { current_stage: newStage, ...additionalUpdates, updated_at: new Date() });
        return session;
      }
    }
    return null;
  },

  async deleteSession(sessionId) {
    for (const [phone, session] of sessions.entries()) {
      if (session.session_id === sessionId) {
        sessions.delete(phone);
        logger.info('ConfigSession deleted:', { phoneNumber: phone, sessionId });
        return true;
      }
    }
    return false;
  },

  async addPendingChange(sessionId, configKey, oldValue, newValue) {
    const session = await this.getSessionById(sessionId);
    if (!session) return null;
    session.pending_changes[configKey] = { old: oldValue, new: newValue };
    session.updated_at = new Date();
    return session;
  },

  async removePendingChange(sessionId, configKey) {
    const session = await this.getSessionById(sessionId);
    if (!session) return null;
    delete session.pending_changes[configKey];
    session.updated_at = new Date();
    return session;
  },

  async clearPendingChanges(sessionId) {
    const session = await this.getSessionById(sessionId);
    if (!session) return null;
    session.pending_changes = {};
    session.updated_at = new Date();
    return session;
  },

  async getPendingChangesSummary(sessionId) {
    const session = await this.getSessionById(sessionId);
    if (!session) return null;
    return session.pending_changes;
  },

  async extendSession(sessionId, extensionMs = 10 * 60 * 1000) {
    const session = await this.getSessionById(sessionId);
    if (!session) return null;
    session.expires_at = new Date(new Date(session.expires_at).getTime() + extensionMs);
    session.timeout_extensions += 1;
    session.updated_at = new Date();
    return session;
  },

  async isSessionNearExpiry(sessionId, warningMinutes = 2) {
    const session = await this.getSessionById(sessionId);
    if (!session) return false;
    const msRemaining = new Date(session.expires_at) - new Date();
    return msRemaining < warningMinutes * 60 * 1000;
  },

  async rollbackSession(sessionId, reason = 'session_timeout') {
    for (const [phone, session] of sessions.entries()) {
      if (session.session_id === sessionId) {
        sessions.delete(phone);
        logger.info('ConfigSession rolled back:', { sessionId, reason });
        return true;
      }
    }
    return false;
  },

  async completeSession(sessionId, appliedChanges = {}) {
    for (const [phone, session] of sessions.entries()) {
      if (session.session_id === sessionId) {
        sessions.delete(phone);
        logger.info('ConfigSession completed:', { sessionId, changeCount: Object.keys(appliedChanges).length });
        return true;
      }
    }
    return false;
  },

  async getSessionsByClient(clientId) {
    const result = [];
    for (const session of sessions.values()) {
      if (session.client_id === clientId && !isExpired(session)) {
        result.push(session);
      }
    }
    return result;
  },

  async hasConflictingSessions(clientId, excludePhoneNumber = null) {
    const clientSessions = await this.getSessionsByClient(clientId);
    if (excludePhoneNumber) {
      return clientSessions.some(s => s.phone_number !== excludePhoneNumber);
    }
    return clientSessions.length > 0;
  },

  async getQueuePosition(clientId, phoneNumber) {
    const clientSessions = await this.getSessionsByClient(clientId);
    const sorted = clientSessions.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const position = sorted.findIndex(s => s.phone_number === phoneNumber);
    return position >= 0 ? position : sorted.length;
  },

  async cleanupExpiredSessions() {
    let count = 0;
    for (const [phone, session] of sessions.entries()) {
      if (isExpired(session)) {
        sessions.delete(phone);
        count++;
      }
    }
    return count;
  },

  async getActiveSessions(filters = {}) {
    const result = [];
    for (const session of sessions.values()) {
      if (!isExpired(session)) result.push(session);
    }
    return result;
  },

  async setConfigurationGroup(sessionId, configGroup) {
    const session = await this.getSessionById(sessionId);
    if (!session) return null;
    session.configuration_group = configGroup;
    session.updated_at = new Date();
    return session;
  },

  async setOriginalState(sessionId, originalState) {
    const session = await this.getSessionById(sessionId);
    if (!session) return null;
    session.original_state = originalState;
    session.updated_at = new Date();
    return session;
  },

  async getSessionStatistics(sessionId) {
    const session = await this.getSessionById(sessionId);
    if (!session) return null;
    return {
      session_id: sessionId,
      duration_ms: new Date() - new Date(session.created_at),
      pending_changes_count: Object.keys(session.pending_changes).length,
      timeout_extensions: session.timeout_extensions
    };
  },

  async monitorClientStatus(sessionId, clientStatusChecker) {
    const session = await this.getSessionById(sessionId);
    if (!session) return false;
    try {
      const isActive = await clientStatusChecker(session.client_id);
      if (!isActive) {
        await this.rollbackSession(sessionId, 'client_inactive');
        return false;
      }
      return true;
    } catch {
      await this.rollbackSession(sessionId, 'client_status_check_failed');
      return false;
    }
  }
};

export default ConfigSessionService;

