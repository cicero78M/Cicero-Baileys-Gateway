// src/model/configSessionModel.js
// Configuration Session Model - WhatsApp Configuration Management  
// Handles session state schema helpers and workflow management

/**
 * Session stage definitions for configuration workflow
 */
export const SESSION_STAGES = {
  SELECTING_CLIENT: 'selecting_client',
  VIEWING_CONFIG: 'viewing_config', 
  SELECTING_GROUP: 'selecting_group',
  MODIFYING_CONFIG: 'modifying_config',
  CONFIRMING_CHANGES: 'confirming_changes',
  TIMEOUT_WARNING: 'timeout_warning'
};

/**
 * Valid session stage values
 */
export const VALID_SESSION_STAGES = Object.values(SESSION_STAGES);

/**
 * Session stage transitions and validation
 */
export const SessionWorkflow = {
  /**
   * Valid stage transitions map
   */
  validTransitions: {
    [SESSION_STAGES.SELECTING_CLIENT]: [SESSION_STAGES.VIEWING_CONFIG, SESSION_STAGES.TIMEOUT_WARNING],
    [SESSION_STAGES.VIEWING_CONFIG]: [SESSION_STAGES.SELECTING_GROUP, SESSION_STAGES.MODIFYING_CONFIG, SESSION_STAGES.TIMEOUT_WARNING],
    [SESSION_STAGES.SELECTING_GROUP]: [SESSION_STAGES.MODIFYING_CONFIG, SESSION_STAGES.VIEWING_CONFIG, SESSION_STAGES.TIMEOUT_WARNING],
    [SESSION_STAGES.MODIFYING_CONFIG]: [SESSION_STAGES.CONFIRMING_CHANGES, SESSION_STAGES.SELECTING_GROUP, SESSION_STAGES.TIMEOUT_WARNING],
    [SESSION_STAGES.CONFIRMING_CHANGES]: [SESSION_STAGES.TIMEOUT_WARNING], // Session ends after confirmation
    [SESSION_STAGES.TIMEOUT_WARNING]: [
      SESSION_STAGES.SELECTING_CLIENT, 
      SESSION_STAGES.VIEWING_CONFIG,
      SESSION_STAGES.SELECTING_GROUP,
      SESSION_STAGES.MODIFYING_CONFIG, 
      SESSION_STAGES.CONFIRMING_CHANGES
    ]
  },

  /**
   * Check if stage transition is valid
   * @param {string} fromStage - Current stage
   * @param {string} toStage - Target stage
   * @returns {boolean} True if transition is valid
   */
  canTransition(fromStage, toStage) {
    const allowedStages = this.validTransitions[fromStage] || [];
    return allowedStages.includes(toStage);
  },

  /**
   * Get next logical stage in workflow
   * @param {string} currentStage - Current session stage
   * @returns {string|null} Next stage or null if workflow complete
   */
  getNextStage(currentStage) {
    const nextStages = {
      [SESSION_STAGES.SELECTING_CLIENT]: SESSION_STAGES.VIEWING_CONFIG,
      [SESSION_STAGES.VIEWING_CONFIG]: SESSION_STAGES.SELECTING_GROUP,
      [SESSION_STAGES.SELECTING_GROUP]: SESSION_STAGES.MODIFYING_CONFIG,
      [SESSION_STAGES.MODIFYING_CONFIG]: SESSION_STAGES.CONFIRMING_CHANGES,
      [SESSION_STAGES.CONFIRMING_CHANGES]: null, // Workflow complete
      [SESSION_STAGES.TIMEOUT_WARNING]: null
    };
    return nextStages[currentStage] || null;
  },

  /**
   * Check if stage requires user input
   * @param {string} stage - Session stage
   * @returns {boolean} True if stage requires user input
   */
  requiresUserInput(stage) {
    return [
      SESSION_STAGES.SELECTING_CLIENT,
      SESSION_STAGES.VIEWING_CONFIG,
      SESSION_STAGES.SELECTING_GROUP,
      SESSION_STAGES.MODIFYING_CONFIG, 
      SESSION_STAGES.CONFIRMING_CHANGES,
      SESSION_STAGES.TIMEOUT_WARNING
    ].includes(stage);
  }
};

/**
 * Session data structure helpers
 */
export const SessionData = {
  /**
   * Create new session data object
   * @param {string} phoneNumber - Administrator phone number
   * @param {string} clientId - Target client ID
   * @param {number} timeoutMs - Session timeout in milliseconds (default: 10 minutes)
   * @returns {Object} Session data object
   */
  create(phoneNumber, clientId, timeoutMs = 10 * 60 * 1000) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + timeoutMs);
    
    return {
      session_id: this.generateSessionId(),
      phone_number: phoneNumber,
      client_id: clientId,
      current_stage: SESSION_STAGES.SELECTING_CLIENT,
      configuration_group: null,
      pending_changes: {},
      original_state: {},
      timeout_extensions: 0,
      expires_at: expiresAt,
      created_at: now,
      updated_at: now
    };
  },

  /**
   * Generate unique session ID
   * @returns {string} UUID v4 session ID
   */
  generateSessionId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  /**
   * Check if session is expired
   * @param {Object} sessionData - Session data object
   * @returns {boolean} True if session is expired
   */
  isExpired(sessionData) {
    return new Date() > new Date(sessionData.expires_at);
  },

  /**
   * Extend session timeout
   * @param {Object} sessionData - Session data object
   * @param {number} extensionMs - Extension time in milliseconds (default: 10 minutes)
   * @returns {Object} Updated session data
   */
  extendTimeout(sessionData, extensionMs = 10 * 60 * 1000) {
    const maxExtensions = 5;
    if (sessionData.timeout_extensions >= maxExtensions) {
      throw new Error(`Maximum session extensions (${maxExtensions}) reached`);
    }

    const currentExpiry = new Date(sessionData.expires_at);
    const newExpiry = new Date(currentExpiry.getTime() + extensionMs);
    
    return {
      ...sessionData,
      expires_at: newExpiry,
      timeout_extensions: sessionData.timeout_extensions + 1,
      updated_at: new Date()
    };
  },

  /**
   * Add pending configuration change
   * @param {Object} sessionData - Session data object
   * @param {string} configKey - Configuration key
   * @param {string} oldValue - Current value
   * @param {string} newValue - New value
   * @returns {Object} Updated session data
   */
  addPendingChange(sessionData, configKey, oldValue, newValue) {
    const pendingChanges = { ...sessionData.pending_changes };
    pendingChanges[configKey] = {
      old_value: oldValue,
      new_value: newValue,
      changed_at: new Date().toISOString()
    };

    return {
      ...sessionData,
      pending_changes: pendingChanges,
      updated_at: new Date()
    };
  },

  /**
   * Remove pending configuration change
   * @param {Object} sessionData - Session data object  
   * @param {string} configKey - Configuration key to remove
   * @returns {Object} Updated session data
   */
  removePendingChange(sessionData, configKey) {
    const pendingChanges = { ...sessionData.pending_changes };
    delete pendingChanges[configKey];

    return {
      ...sessionData,
      pending_changes: pendingChanges,
      updated_at: new Date()
    };
  },

  /**
   * Clear all pending changes
   * @param {Object} sessionData - Session data object
   * @returns {Object} Updated session data
   */
  clearPendingChanges(sessionData) {
    return {
      ...sessionData,
      pending_changes: {},
      updated_at: new Date()
    };
  },

  /**
   * Get summary of pending changes
   * @param {Object} sessionData - Session data object
   * @returns {Object} Change summary
   */
  getPendingChangesSummary(sessionData) {
    const changes = sessionData.pending_changes || {};
    const changeKeys = Object.keys(changes);
    
    return {
      count: changeKeys.length,
      keys: changeKeys,
      hasChanges: changeKeys.length > 0,
      changes: changes
    };
  }
};

/**
 * Validation helpers for session data
 */
export const SessionValidation = {
  /**
   * Validate session stage
   * @param {string} stage - Session stage to validate
   * @returns {boolean} True if stage is valid
   */
  isValidStage(stage) {
    return VALID_SESSION_STAGES.includes(stage);
  },

  /**
   * Validate phone number format
   * @param {string} phoneNumber - Phone number to validate
   * @returns {boolean} True if phone number format is valid
   */
  isValidPhoneNumber(phoneNumber) {
    const phoneRegex = /^\+[1-9][0-9]{7,14}$/;
    return phoneRegex.test(phoneNumber);
  },

  /**
   * Validate session timeout
   * @param {Date|string} expiresAt - Expiry timestamp
   * @returns {boolean} True if expiry is in the future
   */
  isValidExpiry(expiresAt) {
    const expiry = new Date(expiresAt);
    return expiry > new Date() && !isNaN(expiry.getTime());
  },

  /**
   * Validate session data completeness
   * @param {Object} sessionData - Session data to validate
   * @returns {Object} Validation result with errors
   */
  validateSessionData(sessionData) {
    const errors = [];
    
    if (!sessionData.session_id) {
      errors.push('Missing session_id');
    }
    
    if (!this.isValidPhoneNumber(sessionData.phone_number)) {
      errors.push('Invalid phone_number format');
    }
    
    if (!sessionData.client_id) {
      errors.push('Missing client_id');
    }
    
    if (!this.isValidStage(sessionData.current_stage)) {
      errors.push('Invalid current_stage');
    }
    
    if (!this.isValidExpiry(sessionData.expires_at)) {
      errors.push('Invalid expires_at timestamp');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
};
