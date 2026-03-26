// src/model/administratorAuthorizationModel.js
// Administrator Authorization Model - WhatsApp Configuration Management
// Handles phone number validation and permission management

import { query } from '../repository/db.js';

/**
 * Permission level definitions
 */
export const PERMISSION_LEVELS = {
  FULL: 'full',
  READONLY: 'readonly', 
  SPECIFIC_CLIENTS: 'specific_clients'
};

/**
 * Valid permission levels
 */
export const VALID_PERMISSION_LEVELS = Object.values(PERMISSION_LEVELS);

/**
 * Phone number validation and formatting
 */
export const PhoneNumberUtils = {
  /**
   * Validate international phone number format
   * @param {string} phoneNumber - Phone number to validate
   * @returns {boolean} True if format is valid
   */
  isValidFormat(phoneNumber) {
    // International format: +[country_code][subscriber_number]
    // Country code: 1-3 digits, first digit 1-9
    // Subscriber: 7-14 digits total length (including country code)
    const internationalRegex = /^\+[1-9][0-9]{7,14}$/;
    return internationalRegex.test(phoneNumber);
  },

  /**
   * Normalize phone number to international format
   * @param {string} phoneNumber - Phone number to normalize
   * @returns {string|null} Normalized phone number or null if invalid
   */
  normalize(phoneNumber) {
    if (!phoneNumber) return null;
    
    // Remove whitespace and non-digit characters except +
    let cleaned = phoneNumber.replace(/[^\d+]/g, '');
    
    // If starts with +, validate directly
    if (cleaned.startsWith('+')) {
      return this.isValidFormat(cleaned) ? cleaned : null;
    }
    
    // Handle common Indonesian formats
    if (cleaned.startsWith('0')) {
      // Remove leading 0 and add +62 for Indonesia
      cleaned = '+62' + cleaned.slice(1);
    } else if (cleaned.startsWith('62')) {
      // Add + prefix
      cleaned = '+' + cleaned;
    } else if (!cleaned.startsWith('+')) {
      // Assume Indonesia if no country code
      cleaned = '+62' + cleaned;
    }
    
    return this.isValidFormat(cleaned) ? cleaned : null;
  },

  /**
   * Extract country code from phone number
   * @param {string} phoneNumber - International phone number
   * @returns {string|null} Country code or null if invalid
   */
  getCountryCode(phoneNumber) {
    if (!this.isValidFormat(phoneNumber)) return null;
    
    // Extract country code (1-3 digits after +)
    const match = phoneNumber.match(/^\+([1-9][0-9]{0,2})/);
    return match ? match[1] : null;
  },

  /**
   * Format phone number for display
   * @param {string} phoneNumber - International phone number
   * @returns {string} Formatted display string
   */
  formatForDisplay(phoneNumber) {
    if (!this.isValidFormat(phoneNumber)) return phoneNumber;
    
    const countryCode = this.getCountryCode(phoneNumber);
    const subscriberNumber = phoneNumber.slice(countryCode.length + 1);
    
    // Format Indonesian numbers specially
    if (countryCode === '62') {
      return `+62 ${subscriberNumber.replace(/(\d{3})(\d{4})(\d+)/, '$1-$2-$3')}`;
    }
    
    // Generic formatting
    return `+${countryCode} ${subscriberNumber}`;
  }
};

/**
 * Permission and access control helpers
 */
export const PermissionUtils = {
  /**
   * Check if permission level is valid
   * @param {string} level - Permission level to validate
   * @returns {boolean} True if permission level is valid
   */
  isValidPermissionLevel(level) {
    return VALID_PERMISSION_LEVELS.includes(level);
  },

  /**
   * Check if user can access a specific client
   * @param {Object} authData - Administrator authorization data
   * @param {string} clientId - Client ID to check access for
   * @returns {boolean} True if user can access the client
   */
  canAccessClient(authData, clientId) {
    if (!authData || !authData.is_authorized) {
      return false;
    }
    
    // Full permission allows access to all clients
    if (authData.permission_level === PERMISSION_LEVELS.FULL) {
      return true;
    }
    
    // Readonly permission allows viewing all clients  
    if (authData.permission_level === PERMISSION_LEVELS.READONLY) {
      return true;
    }
    
    // Specific clients permission requires client ID to be in scope
    if (authData.permission_level === PERMISSION_LEVELS.SPECIFIC_CLIENTS) {
      const clientScope = authData.client_access_scope || [];
      return clientScope.includes(clientId);
    }
    
    return false;
  },

  /**
   * Check if user can modify client configuration
   * @param {Object} authData - Administrator authorization data
   * @param {string} clientId - Client ID to check modification rights for
   * @returns {boolean} True if user can modify the client configuration
   */
  canModifyClient(authData, clientId) {
    if (!authData || !authData.is_authorized) {
      return false;
    }
    
    // Readonly permission cannot modify
    if (authData.permission_level === PERMISSION_LEVELS.READONLY) {
      return false;
    }
    
    // Check access permission first
    return this.canAccessClient(authData, clientId);
  },

  /**
   * Get accessible client IDs for user
   * @param {Object} authData - Administrator authorization data
   * @param {string[]} allClientIds - All available client IDs
   * @returns {string[]} Client IDs user can access
   */
  getAccessibleClients(authData, allClientIds) {
    if (!authData || !authData.is_authorized) {
      return [];
    }
    
    // Full and readonly permissions allow access to all clients
    if ([PERMISSION_LEVELS.FULL, PERMISSION_LEVELS.READONLY].includes(authData.permission_level)) {
      return [...allClientIds];
    }
    
    // Specific clients permission filters by scope
    if (authData.permission_level === PERMISSION_LEVELS.SPECIFIC_CLIENTS) {
      const clientScope = authData.client_access_scope || [];
      return allClientIds.filter(clientId => clientScope.includes(clientId));
    }
    
    return [];
  },

  /**
   * Get permission level display name
   * @param {string} level - Permission level
   * @returns {string} Human-readable permission level name
   */
  getPermissionDisplayName(level) {
    const displayNames = {
      [PERMISSION_LEVELS.FULL]: 'Full Access',
      [PERMISSION_LEVELS.READONLY]: 'Read Only',
      [PERMISSION_LEVELS.SPECIFIC_CLIENTS]: 'Specific Clients Only'
    };
    return displayNames[level] || level;
  }
};

/**
 * Authorization data structure helpers
 */
export const AuthorizationData = {
  /**
   * Create new authorization record
   * @param {string} phoneNumber - Phone number in international format
   * @param {Object} options - Authorization options
   * @returns {Object} Authorization data object
   */
  create(phoneNumber, {
    permissionLevel = PERMISSION_LEVELS.FULL,
    clientAccessScope = [],
    isAuthorized = true
  } = {}) {
    const normalizedPhone = PhoneNumberUtils.normalize(phoneNumber);
    if (!normalizedPhone) {
      throw new Error(`Invalid phone number format: ${phoneNumber}`);
    }
    
    if (!PermissionUtils.isValidPermissionLevel(permissionLevel)) {
      throw new Error(`Invalid permission level: ${permissionLevel}`);
    }
    
    const now = new Date();
    
    return {
      phone_number: normalizedPhone,
      is_authorized: isAuthorized,
      client_access_scope: clientAccessScope,
      permission_level: permissionLevel,
      created_at: now,
      updated_at: now
    };
  },

  /**
   * Update authorization record
   * @param {Object} authData - Current authorization data
   * @param {Object} updates - Updates to apply
   * @returns {Object} Updated authorization data
   */
  update(authData, updates) {
    const updatedData = {
      ...authData,
      ...updates,
      updated_at: new Date()
    };
    
    // Validate permission level if changed
    if (updates.permission_level && !PermissionUtils.isValidPermissionLevel(updates.permission_level)) {
      throw new Error(`Invalid permission level: ${updates.permission_level}`);
    }
    
    return updatedData;
  },

  /**
   * Revoke authorization
   * @param {Object} authData - Authorization data to revoke
   * @returns {Object} Updated authorization data with revoked access
   */
  revoke(authData) {
    return this.update(authData, {
      is_authorized: false,
      permission_level: PERMISSION_LEVELS.READONLY,
      client_access_scope: []
    });
  },

  /**
   * Grant full authorization
   * @param {Object} authData - Authorization data to grant full access
   * @returns {Object} Updated authorization data with full access
   */
  grantFullAccess(authData) {
    return this.update(authData, {
      is_authorized: true,
      permission_level: PERMISSION_LEVELS.FULL,
      client_access_scope: []
    });
  }
};

/**
 * Validation helpers for authorization data
 */
export const AuthorizationValidation = {
  /**
   * Validate authorization data structure
   * @param {Object} authData - Authorization data to validate  
   * @returns {Object} Validation result with errors
   */
  validateAuthorizationData(authData) {
    const errors = [];
    
    if (!PhoneNumberUtils.isValidFormat(authData.phone_number)) {
      errors.push('Invalid phone_number format - must be international format (+country_code_number)');
    }
    
    if (typeof authData.is_authorized !== 'boolean') {
      errors.push('is_authorized must be boolean');
    }
    
    if (!PermissionUtils.isValidPermissionLevel(authData.permission_level)) {
      errors.push(`Invalid permission_level - must be one of: ${VALID_PERMISSION_LEVELS.join(', ')}`);
    }
    
    if (authData.client_access_scope && !Array.isArray(authData.client_access_scope)) {
      errors.push('client_access_scope must be array');
    }
    
    if (authData.permission_level === PERMISSION_LEVELS.SPECIFIC_CLIENTS) {
      if (!authData.client_access_scope || authData.client_access_scope.length === 0) {
        errors.push('client_access_scope is required for specific_clients permission level');
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
  PERMISSION_LEVELS,
  PhoneNumberUtils, 
  PermissionUtils,
  AuthorizationData,
  AuthorizationValidation
};