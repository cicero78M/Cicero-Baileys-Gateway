// src/service/configSessionService.js
// Configuration Session Service - WhatsApp Configuration Management
// Session state management and workflow orchestration

import { pool } from '../db/index.js';
import * as configSessionRepo from '../repository/configSessionRepository.js';
import * as auditLogRepo from '../repository/configurationAuditLogRepository.js';
import { SessionData, SessionWorkflow, SESSION_STAGES } from '../model/configSessionModel.js';
import { AuditLogData, AUDIT_ACTION_TYPES } from '../model/configurationAuditLogModel.js';

/**
 * Configuration Session Management Service
 */
export const ConfigSessionService = {
  /**
   * Create new configuration session for administrator
   * @param {string} phoneNumber - Administrator phone number
   * @param {string} clientId - Target client ID for configuration
   * @param {Object} options - Session options
   * @returns {Promise<Object>} Created session data
   */
  async createSession(phoneNumber, clientId, {
    timeoutMs = 10 * 60 * 1000, // 10 minutes default
    originalState = {}
  } = {}) {
    // Clean up any existing session for this phone number
    await configSessionRepo.deleteSessionByPhone(pool, phoneNumber);

    // Create new session
    const sessionData = SessionData.create(phoneNumber, clientId, timeoutMs);
    sessionData.original_state = originalState;

    const session = await configSessionRepo.createSession(pool, sessionData);

    // Create audit log entry
    const auditEntry = AuditLogData.create(
      session.session_id,
      clientId,
      phoneNumber,
      AUDIT_ACTION_TYPES.START_SESSION
    );
    await auditLogRepo.createAuditLog(pool, auditEntry);

    return session;
  },

  /**
   * Get active session by phone number
   * @param {string} phoneNumber - Administrator phone number
   * @returns {Promise<Object|null>} Active session or null if not found
   */
  async getActiveSession(phoneNumber) {
    return await configSessionRepo.getActiveSessionByPhone(pool, phoneNumber);
  },

  /**
   * Get session by session ID
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object|null>} Session data or null if not found
   */
  async getSessionById(sessionId) {
    return await configSessionRepo.getSessionById(pool, sessionId);
  },

  /**
   * Update session stage with validation
   * @param {string} sessionId - Session ID to update
   * @param {string} newStage - New session stage
   * @param {Object} additionalUpdates - Additional updates to apply
   * @returns {Promise<Object|null>} Updated session or null if not found/invalid
   */
  async updateSessionStage(sessionId, newStage, additionalUpdates = {}) {
    const session = await configSessionRepo.getSessionById(pool, sessionId);
    if (!session) {
      return null;
    }

    // Check if stage transition is valid
    if (!SessionWorkflow.canTransition(session.current_stage, newStage)) {
      throw new Error(`Invalid stage transition from ${session.current_stage} to ${newStage}`);
    }

    const updates = {
      current_stage: newStage,
      ...additionalUpdates
    };

    return await configSessionRepo.updateSession(pool, sessionId, updates);
  },

  /**
   * Add pending configuration change to session
   * @param {string} sessionId - Session ID
   * @param {string} configKey - Configuration key being changed
   * @param {string} oldValue - Current value
   * @param {string} newValue - New value
   * @returns {Promise<Object|null>} Updated session or null if not found
   */
  async addPendingChange(sessionId, configKey, oldValue, newValue) {
    const session = await configSessionRepo.getSessionById(pool, sessionId);
    if (!session) {
      return null;
    }

    // Add to session pending changes
    const updatedSession = await configSessionRepo.addPendingChange(
      pool, sessionId, configKey, oldValue, newValue
    );

    // Create audit log entry
    if (updatedSession) {
      const auditEntry = AuditLogData.createModificationEntry(
        sessionId,
        session.client_id,
        session.phone_number,
        configKey,
        oldValue,
        newValue
      );
      await auditLogRepo.createAuditLog(pool, auditEntry);
    }

    return updatedSession;
  },

  /**
   * Remove pending change from session
   * @param {string} sessionId - Session ID
   * @param {string} configKey - Configuration key to remove
   * @returns {Promise<Object|null>} Updated session or null if not found
   */
  async removePendingChange(sessionId, configKey) {
    const session = await configSessionRepo.getSessionById(pool, sessionId);
    if (!session) {
      return null;
    }

    const pendingChanges = { ...session.pending_changes };
    delete pendingChanges[configKey];

    return await configSessionRepo.updateSession(pool, sessionId, {
      pending_changes: pendingChanges
    });
  },

  /**
   * Clear all pending changes from session
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object|null>} Updated session or null if not found
   */
  async clearPendingChanges(sessionId) {
    return await configSessionRepo.clearPendingChanges(pool, sessionId);
  },

  /**
   * Get pending changes summary for session
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object|null>} Changes summary or null if session not found
   */
  async getPendingChangesSummary(sessionId) {
    const session = await configSessionRepo.getSessionById(pool, sessionId);
    if (!session) {
      return null;
    }

    return SessionData.getPendingChangesSummary(session);
  },

  /**
   * Extend session timeout
   * @param {string} sessionId - Session ID to extend
   * @param {number} extensionMs - Extension time in milliseconds
   * @returns {Promise<Object|null>} Updated session or null if not found/max extensions reached
   */
  async extendSession(sessionId, extensionMs = 10 * 60 * 1000) {
    const session = await configSessionRepo.getSessionById(pool, sessionId);
    if (!session) {
      return null;
    }

    const updatedSession = await configSessionRepo.extendSessionTimeout(pool, sessionId, extensionMs);
    
    if (updatedSession) {
      // Create audit log entry
      const auditEntry = AuditLogData.create(
        sessionId,
        session.client_id,
        session.phone_number,
        AUDIT_ACTION_TYPES.EXTEND_SESSION,
        { extensionCount: updatedSession.timeout_extensions }
      );
      await auditLogRepo.createAuditLog(pool, auditEntry);
    }

    return updatedSession;
  },

  /**
   * Check if session is near expiry (for timeout warnings)
   * @param {string} sessionId - Session ID to check
   * @param {number} warningMinutes - Minutes before expiry to trigger warning
   * @returns {Promise<boolean>} True if session is near expiry
   */
  async isSessionNearExpiry(sessionId, warningMinutes = 2) {
    return await configSessionRepo.isSessionNearExpiry(pool, sessionId, warningMinutes);
  },

  /**
   * Rollback session due to client becoming inactive or other issues
   * @param {string} sessionId - Session ID to rollback
   * @param {string} reason - Reason for rollback
   * @returns {Promise<boolean>} True if rollback successful
   */
  async rollbackSession(sessionId, reason = 'session_timeout') {
    const session = await configSessionRepo.getSessionById(pool, sessionId);
    if (!session) {
      return false;
    }

    // Create rollback audit log entry
    const auditEntry = AuditLogData.createRollbackEntry(
      sessionId,
      session.client_id,
      session.phone_number,
      reason,
      session.pending_changes
    );
    await auditLogRepo.createAuditLog(pool, auditEntry);

    // Delete the session
    await configSessionRepo.deleteSession(pool, sessionId);

    return true;
  },

  /**
   * Complete session successfully (after changes confirmed and applied)
   * @param {string} sessionId - Session ID to complete
   * @param {Object} appliedChanges - Changes that were actually applied
   * @returns {Promise<boolean>} True if completion successful
   */
  async completeSession(sessionId, appliedChanges = {}) {
    const session = await configSessionRepo.getSessionById(pool, sessionId);
    if (!session) {
      return false;
    }

    // Create confirmation audit log entry
    const auditEntry = AuditLogData.createConfirmationEntry(
      sessionId,
      session.client_id,
      session.phone_number,
      appliedChanges
    );
    await auditLogRepo.createAuditLog(pool, auditEntry);

    // Delete the session
    await configSessionRepo.deleteSession(pool, sessionId);

    return true;
  },

  /**
   * Get sessions by client ID (for conflict detection)
   * @param {string} clientId - Client ID to check
   * @returns {Promise<Array>} Array of active sessions for the client
   */
  async getSessionsByClient(clientId) {
    return await configSessionRepo.getSessionsByClient(pool, clientId);
  },

  /**
   * Check if client has concurrent configuration sessions
   * @param {string} clientId - Client ID to check
   * @param {string} excludePhoneNumber - Phone number to exclude from check
   * @returns {Promise<boolean>} True if there are other active sessions
   */
  async hasConflictingSessions(clientId, excludePhoneNumber = null) {
    const sessions = await this.getSessionsByClient(clientId);
    
    if (excludePhoneNumber) {
      return sessions.some(session => session.phone_number !== excludePhoneNumber);
    }
    
    return sessions.length > 0;
  },

  /**
   * Get queue position for client configuration request
   * @param {string} clientId - Client ID
   * @param {string} phoneNumber - Requesting phone number
   * @returns {Promise<number>} Queue position (0 if no queue)
   */
  async getQueuePosition(clientId, phoneNumber) {
    const sessions = await this.getSessionsByClient(clientId);
    const sortedSessions = sessions.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    
    const position = sortedSessions.findIndex(session => session.phone_number === phoneNumber);
    return position >= 0 ? position : sortedSessions.length;
  },

  /**
   * Clean up expired sessions
   * @returns {Promise<number>} Number of sessions cleaned up
   */
  async cleanupExpiredSessions() {
    return await configSessionRepo.cleanupExpiredSessions(pool);
  },

  /**
   * Get session statistics for monitoring
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object|null>} Session statistics or null if not found
   */
  async getSessionStatistics(sessionId) {
    return await auditLogRepo.getSessionStatistics(pool, sessionId);
  },

  /**
   * Monitor client status during session lifecycle
   * @param {string} sessionId - Session ID to monitor
   * @param {Function} clientStatusChecker - Function to check if client is active
   * @returns {Promise<boolean>} True if client is still active
   */
  async monitorClientStatus(sessionId, clientStatusChecker) {
    const session = await this.getSessionById(sessionId);
    if (!session) {
      return false;
    }

    try {
      const isActive = await clientStatusChecker(session.client_id);
      
      if (!isActive) {
        // Client became inactive - rollback session
        await this.rollbackSession(sessionId, 'client_inactive');
        return false;
      }
      
      return true;
    } catch (error) {
      // Error checking client status - assume inactive and rollback
      await this.rollbackSession(sessionId, 'client_status_check_failed');
      return false;
    }
  },

  /**
   * Get all active sessions (for monitoring/debugging)
   * @param {Object} filters - Optional filters
   * @returns {Promise<Array>} Array of active sessions
   */
  async getActiveSessions(filters = {}) {
    return await configSessionRepo.getActiveSessions(pool, filters);
  },

  /**
   * Set session configuration group (for tracking current modification group)
   * @param {string} sessionId - Session ID
   * @param {string} configGroup - Configuration group being modified
   * @returns {Promise<Object|null>} Updated session or null if not found
   */
  async setConfigurationGroup(sessionId, configGroup) {
    return await configSessionRepo.updateSession(pool, sessionId, {
      configuration_group: configGroup
    });
  },

  /**
   * Store original configuration state for rollback capability
   * @param {string} sessionId - Session ID
   * @param {Object} originalState - Original configuration state
   * @returns {Promise<Object|null>} Updated session or null if not found
   */
  async setOriginalState(sessionId, originalState) {
    return await configSessionRepo.updateSession(pool, sessionId, {
      original_state: originalState
    });
  }
};

export default ConfigSessionService;