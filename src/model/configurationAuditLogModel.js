// src/model/configurationAuditLogModel.js
// Configuration Audit Log Model - WhatsApp Configuration Management
// Handles change tracking and compliance logging

import { query } from '../repository/db.js';

/**
 * Audit action type definitions
 */
export const AUDIT_ACTION_TYPES = {
  VIEW_CONFIG: 'view_config',
  START_SESSION: 'start_session', 
  MODIFY_CONFIG: 'modify_config',
  CONFIRM_CHANGES: 'confirm_changes',
  ROLLBACK_SESSION: 'rollback_session',
  EXTEND_SESSION: 'extend_session'
};

/**
 * Valid audit action types
 */
export const VALID_AUDIT_ACTION_TYPES = Object.values(AUDIT_ACTION_TYPES);

/**
 * Audit log data structure helpers
 */
export const AuditLogData = {
  /**
   * Create new audit log entry
   * @param {string} sessionId - Configuration session ID
   * @param {string} clientId - Client ID being modified
   * @param {string} phoneNumber - Administrator phone number
   * @param {string} actionType - Type of action performed
   * @param {Object} details - Additional action details
   * @returns {Object} Audit log entry
   */
  create(sessionId, clientId, phoneNumber, actionType, details = {}) {
    if (!VALID_AUDIT_ACTION_TYPES.includes(actionType)) {
      throw new Error(`Invalid audit action type: ${actionType}`);
    }
    
    const baseEntry = {
      session_id: sessionId,
      client_id: clientId,
      phone_number: phoneNumber,
      action_type: actionType,
      created_at: new Date()
    };
    
    // Add action-specific details
    switch (actionType) {
      case AUDIT_ACTION_TYPES.VIEW_CONFIG:
        return {
          ...baseEntry,
          config_key: null,
          old_value: null,
          new_value: null,
          change_summary: `Administrator viewed configuration for client ${clientId}`
        };
        
      case AUDIT_ACTION_TYPES.START_SESSION:
        return {
          ...baseEntry,
          config_key: null,
          old_value: null,
          new_value: null,
          change_summary: `Configuration session started for client ${clientId}`
        };
        
      case AUDIT_ACTION_TYPES.MODIFY_CONFIG:
        return {
          ...baseEntry,
          config_key: details.configKey || null,
          old_value: details.oldValue || null,
          new_value: details.newValue || null,
          change_summary: details.changeSummary || `Configuration ${details.configKey} modified`
        };
        
      case AUDIT_ACTION_TYPES.CONFIRM_CHANGES:
        return {
          ...baseEntry,
          config_key: null,
          old_value: null,
          new_value: null,
          change_summary: details.changeSummary || `Configuration changes confirmed and applied to client ${clientId}`
        };
        
      case AUDIT_ACTION_TYPES.ROLLBACK_SESSION:
        return {
          ...baseEntry,
          config_key: null,
          old_value: null,
          new_value: null,
          change_summary: details.changeSummary || `Configuration session rolled back for client ${clientId} due to ${details.reason || 'session timeout'}`
        };
        
      case AUDIT_ACTION_TYPES.EXTEND_SESSION:
        return {
          ...baseEntry,
          config_key: null,
          old_value: null,
          new_value: null,
          change_summary: `Configuration session extended for client ${clientId} (extension ${details.extensionCount || 1})`
        };
        
      default:
        return {
          ...baseEntry,
          config_key: null,
          old_value: null,
          new_value: null,
          change_summary: `${actionType} performed on client ${clientId}`
        };
    }
  },

  /**
   * Create modification audit log entry
   * @param {string} sessionId - Configuration session ID
   * @param {string} clientId - Client ID
   * @param {string} phoneNumber - Administrator phone number
   * @param {string} configKey - Configuration key modified
   * @param {string} oldValue - Previous value
   * @param {string} newValue - New value
   * @param {string} changeSummary - Description of the change
   * @returns {Object} Modification audit log entry
   */
  createModificationEntry(sessionId, clientId, phoneNumber, configKey, oldValue, newValue, changeSummary = null) {
    const autoSummary = `Changed ${configKey} from "${oldValue}" to "${newValue}"`;
    
    return this.create(sessionId, clientId, phoneNumber, AUDIT_ACTION_TYPES.MODIFY_CONFIG, {
      configKey,
      oldValue,
      newValue,
      changeSummary: changeSummary || autoSummary
    });
  },

  /**
   * Create session rollback audit log entry
   * @param {string} sessionId - Configuration session ID  
   * @param {string} clientId - Client ID
   * @param {string} phoneNumber - Administrator phone number
   * @param {string} reason - Reason for rollback
   * @param {Object} pendingChanges - Changes that were rolled back
   * @returns {Object} Rollback audit log entry
   */
  createRollbackEntry(sessionId, clientId, phoneNumber, reason, pendingChanges = {}) {
    const changeCount = Object.keys(pendingChanges).length;
    const changeSummary = `Session rolled back due to ${reason}. ${changeCount} pending changes were discarded.`;
    
    return this.create(sessionId, clientId, phoneNumber, AUDIT_ACTION_TYPES.ROLLBACK_SESSION, {
      reason,
      changeSummary
    });
  },

  /**
   * Create batch confirmation audit log entry
   * @param {string} sessionId - Configuration session ID
   * @param {string} clientId - Client ID
   * @param {string} phoneNumber - Administrator phone number
   * @param {Object} confirmedChanges - Changes that were confirmed
   * @returns {Object} Confirmation audit log entry
   */
  createConfirmationEntry(sessionId, clientId, phoneNumber, confirmedChanges = {}) {
    const changeKeys = Object.keys(confirmedChanges);
    const changeCount = changeKeys.length;
    const changeSummary = `${changeCount} configuration changes confirmed and applied: ${changeKeys.join(', ')}`;
    
    return this.create(sessionId, clientId, phoneNumber, AUDIT_ACTION_TYPES.CONFIRM_CHANGES, {
      changeSummary
    });
  }
};

/**
 * Audit log query helpers
 */
export const AuditLogQuery = {
  /**
   * Build query filters for audit log search
   * @param {Object} filters - Search filters
   * @returns {Object} Query conditions and parameters
   */
  buildSearchFilters(filters = {}) {
    const conditions = [];
    const parameters = [];
    let paramIndex = 1;
    
    if (filters.clientId) {
      conditions.push(`client_id = $${paramIndex++}`);
      parameters.push(filters.clientId);
    }
    
    if (filters.phoneNumber) {
      conditions.push(`phone_number = $${paramIndex++}`);
      parameters.push(filters.phoneNumber);
    }
    
    if (filters.actionType) {
      conditions.push(`action_type = $${paramIndex++}`);
      parameters.push(filters.actionType);
    }
    
    if (filters.sessionId) {
      conditions.push(`session_id = $${paramIndex++}`);
      parameters.push(filters.sessionId);
    }
    
    if (filters.configKey) {
      conditions.push(`config_key = $${paramIndex++}`);
      parameters.push(filters.configKey);
    }
    
    if (filters.dateFrom) {
      conditions.push(`created_at >= $${paramIndex++}`);
      parameters.push(filters.dateFrom);
    }
    
    if (filters.dateTo) {
      conditions.push(`created_at <= $${paramIndex++}`);
      parameters.push(filters.dateTo);
    }
    
    return {
      whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      parameters
    };
  },

  /**
   * Get default sort order for audit logs  
   * @param {string} sortBy - Sort field (created_at, client_id, action_type)
   * @param {string} sortOrder - Sort direction (ASC, DESC)
   * @returns {string} SQL ORDER BY clause
   */
  getDefaultSort(sortBy = 'created_at', sortOrder = 'DESC') {
    const validSortFields = ['created_at', 'client_id', 'action_type', 'phone_number', 'log_id'];
    const validSortOrders = ['ASC', 'DESC'];
    
    const field = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const order = validSortOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';
    
    return `ORDER BY ${field} ${order}`;
  }
};

/**
 * Audit log analysis helpers
 */
export const AuditLogAnalysis = {
  /**
   * Group audit logs by action type
   * @param {Array} auditLogs - Array of audit log entries
   * @returns {Object} Logs grouped by action type
   */
  groupByActionType(auditLogs) {
    return auditLogs.reduce((groups, log) => {
      const actionType = log.action_type;
      if (!groups[actionType]) {
        groups[actionType] = [];
      }
      groups[actionType].push(log);
      return groups;
    }, {});
  },

  /**
   * Generate change summary for a session
   * @param {Array} sessionLogs - Audit logs for a specific session
   * @returns {Object} Session change summary
   */
  generateSessionSummary(sessionLogs) {
    const logsByAction = this.groupByActionType(sessionLogs);
    
    const modifications = logsByAction[AUDIT_ACTION_TYPES.MODIFY_CONFIG] || [];
    const confirmations = logsByAction[AUDIT_ACTION_TYPES.CONFIRM_CHANGES] || [];
    const rollbacks = logsByAction[AUDIT_ACTION_TYPES.ROLLBACK_SESSION] || [];
    
    return {
      sessionId: sessionLogs[0]?.session_id,
      clientId: sessionLogs[0]?.client_id,
      phoneNumber: sessionLogs[0]?.phone_number,
      startTime: sessionLogs[0]?.created_at,
      endTime: sessionLogs[sessionLogs.length - 1]?.created_at,
      totalActions: sessionLogs.length,
      modificationsCount: modifications.length,
      wasConfirmed: confirmations.length > 0,
      wasRolledBack: rollbacks.length > 0,
      modifiedKeys: modifications.map(log => log.config_key).filter(key => key),
      status: rollbacks.length > 0 ? 'rolled_back' : 
              confirmations.length > 0 ? 'confirmed' : 'incomplete'
    };
  },

  /**
   * Get configuration change history for a specific key
   * @param {Array} auditLogs - Array of audit log entries
   * @param {string} configKey - Configuration key to track
   * @returns {Array} Change history for the configuration key
   */
  getConfigKeyHistory(auditLogs, configKey) {
    return auditLogs
      .filter(log => log.config_key === configKey && log.action_type === AUDIT_ACTION_TYPES.MODIFY_CONFIG)
      .map(log => ({
        sessionId: log.session_id,
        phoneNumber: log.phone_number,
        oldValue: log.old_value,
        newValue: log.new_value,
        changedAt: log.created_at,
        changeSummary: log.change_summary
      }))
      .sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));
  }
};

/**
 * Validation helpers for audit log data
 */
export const AuditLogValidation = {
  /**
   * Validate audit log entry structure
   * @param {Object} logEntry - Audit log entry to validate
   * @returns {Object} Validation result with errors
   */
  validateLogEntry(logEntry) {
    const errors = [];
    
    if (!logEntry.session_id) {
      errors.push('Missing session_id');
    }
    
    if (!logEntry.client_id) {
      errors.push('Missing client_id');
    }
    
    if (!logEntry.phone_number) {
      errors.push('Missing phone_number');
    }
    
    if (!VALID_AUDIT_ACTION_TYPES.includes(logEntry.action_type)) {
      errors.push(`Invalid action_type - must be one of: ${VALID_AUDIT_ACTION_TYPES.join(', ')}`);
    }
    
    if (!logEntry.change_summary) {
      errors.push('Missing change_summary');
    }
    
    // Validate modification-specific fields
    if (logEntry.action_type === AUDIT_ACTION_TYPES.MODIFY_CONFIG) {
      if (!logEntry.config_key) {
        errors.push('config_key is required for modify_config action');
      }
      if (logEntry.old_value === undefined || logEntry.new_value === undefined) {
        errors.push('old_value and new_value are required for modify_config action');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
};

// Export all components
export { 
  VALID_AUDIT_ACTION_TYPES,
  AuditLogData,
  AuditLogQuery,
  AuditLogAnalysis,
  AuditLogValidation
};