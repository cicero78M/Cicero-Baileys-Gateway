// src/utils/configValidator.js  
// Configuration Validator - WhatsApp Configuration Management
// Input validation and format rules for configuration parameters

import { CONFIG_GROUPS, parseConfigKey } from '../model/clientConfigModel.js';

/**
 * Configuration validation rules organized by configuration group
 */
export const ValidationRules = {
  [CONFIG_GROUPS.CONNECTION]: {
    host: {
      pattern: /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
      description: 'Valid hostname or IP address (e.g., api.example.com, 192.168.1.1)',
      examples: ['gateway.example.com', 'api.service.local', '192.168.1.100']
    },
    port: {
      pattern: /^([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/,
      description: 'Valid port number (1-65535)',
      examples: ['8080', '443', '3000', '9999']
    },
    ssl_enabled: {
      pattern: /^(true|false)$/i,
      description: 'Boolean flag (true/false)',
      examples: ['true', 'false']
    },
    timeout: {
      pattern: /^[1-9][0-9]*$/,
      description: 'Positive integer in milliseconds (minimum 1000)',
      examples: ['30000', '60000', '120000'],
      validate: (value) => {
        const num = parseInt(value);
        return num >= 1000 && num <= 300000; // 1 second to 5 minutes
      }
    }
  },

  [CONFIG_GROUPS.MESSAGE_HANDLING]: {
    max_queue_size: {
      pattern: /^[1-9][0-9]*$/,
      description: 'Positive integer for maximum queue size',
      examples: ['100', '1000', '5000'],
      validate: (value) => {
        const num = parseInt(value);
        return num >= 10 && num <= 10000; // 10 to 10,000 messages
      }
    },
    retry_attempts: {
      pattern: /^(0|[1-9]|10)$/,
      description: 'Number of retry attempts (0-10)',
      examples: ['0', '3', '5', '10']
    },
    rate_limit: {
      pattern: /^[1-9][0-9]*\/(second|minute|hour)$/i,
      description: 'Rate limit in format "number/unit" (e.g., 40/minute)',
      examples: ['40/minute', '1/second', '100/hour', '2400/hour']
    }
  },

  [CONFIG_GROUPS.NOTIFICATIONS]: {
    status_alerts: {
      pattern: /^(true|false)$/i,
      description: 'Boolean flag for status change alerts',
      examples: ['true', 'false']
    },
    error_reports: {
      pattern: /^(true|false)$/i,
      description: 'Boolean flag for error report notifications',
      examples: ['true', 'false']
    },
    daily_summary: {
      pattern: /^(true|false)$/i,
      description: 'Boolean flag for daily summary reports',
      examples: ['true', 'false']
    }
  },

  [CONFIG_GROUPS.AUTOMATION_RULES]: {
    auto_response: {
      pattern: /^(true|false)$/i,
      description: 'Boolean flag for automatic response processing',
      examples: ['true', 'false']
    },
    complaint_processing: {
      pattern: /^(true|false)$/i,
      description: 'Boolean flag for automatic complaint handling',
      examples: ['true', 'false']
    },
    task_broadcasting: {
      pattern: /^(true|false)$/i,
      description: 'Boolean flag for automatic task broadcasting',
      examples: ['true', 'false']
    }
  }
};

/**
 * Common validation patterns for reuse
 */
export const CommonPatterns = {
  boolean: /^(true|false)$/i,
  positiveInteger: /^[1-9][0-9]*$/,
  nonNegativeInteger: /^(0|[1-9][0-9]*)$/,
  hostname: /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
  ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
  port: /^([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/,
  rateLimit: /^[1-9][0-9]*\/(second|minute|hour)$/i
};

/**
 * Core validation functions
 */
export const ConfigValidator = {
  /**
   * Validate configuration value against rules
   * @param {string} configKey - Configuration key (e.g., 'connection.host')
   * @param {string} configValue - Value to validate
   * @param {string} [validationPattern] - Optional custom validation pattern
   * @returns {Object} Validation result
   */
  validateValue(configKey, configValue, validationPattern = null) {
    if (!configValue && configValue !== '0' && configValue !== 'false') {
      return {
        isValid: false,
        error: 'Configuration value cannot be empty',
        suggestions: []
      };
    }

    const parsedKey = parseConfigKey(configKey);
    
    if (!parsedKey.isValid) {
      return {
        isValid: false,
        error: `Invalid configuration key format: ${configKey}`,
        suggestions: ['Use format: group.parameter (e.g., connection.host)']
      };
    }

    // Use custom validation pattern if provided
    if (validationPattern) {
      try {
        const regex = new RegExp(validationPattern);
        const isValid = regex.test(configValue);
        return {
          isValid,
          error: isValid ? null : `Value "${configValue}" does not match required format`,
          suggestions: isValid ? [] : ['Check the expected format for this configuration parameter']
        };
      } catch (error) {
        return {
          isValid: false,
          error: `Invalid validation pattern: ${error.message}`,
          suggestions: []
        };
      }
    }

    // Use built-in validation rules
    const groupRules = ValidationRules[parsedKey.group];
    if (!groupRules) {
      return {
        isValid: true,
        error: null,
        suggestions: []
      };
    }

    const parameterRule = groupRules[parsedKey.parameter];
    if (!parameterRule) {
      return {
        isValid: true,
        error: null,
        suggestions: []
      };
    }

    // Pattern validation
    if (parameterRule.pattern && !parameterRule.pattern.test(configValue)) {
      return {
        isValid: false,
        error: `Invalid format. ${parameterRule.description}`,
        suggestions: parameterRule.examples || []
      };
    }

    // Custom validation function
    if (parameterRule.validate && !parameterRule.validate(configValue)) {
      return {
        isValid: false,
        error: `Invalid value. ${parameterRule.description}`,
        suggestions: parameterRule.examples || []
      };
    }

    return {
      isValid: true,
      error: null,
      suggestions: []
    };
  },

  /**
   * Get validation rules for a specific configuration key
   * @param {string} configKey - Configuration key to get rules for
   * @returns {Object|null} Validation rule object or null if not found
   */
  getValidationRule(configKey) {
    const parsedKey = parseConfigKey(configKey);
    
    if (!parsedKey.isValid) {
      return null;
    }

    const groupRules = ValidationRules[parsedKey.group];
    if (!groupRules) {
      return null;
    }

    return groupRules[parsedKey.parameter] || null;
  },

  /**
   * Validate multiple configuration values
   * @param {Object} configChanges - Object mapping config keys to values
   * @param {Object} [validationPatterns] - Object mapping config keys to validation patterns
   * @returns {Object} Validation results for all values
   */
  validateMultiple(configChanges, validationPatterns = {}) {
    const results = [];
    let hasErrors = false;

    for (const [configKey, configValue] of Object.entries(configChanges)) {
      const validationPattern = validationPatterns[configKey] || null;
      const result = this.validateValue(configKey, configValue, validationPattern);
      
      if (!result.isValid) {
        hasErrors = true;
      }

      results.push({
        configKey,
        configValue,
        ...result
      });
    }

    return {
      isValid: !hasErrors,
      results,
      errorCount: results.filter(r => !r.isValid).length,
      validCount: results.filter(r => r.isValid).length
    };
  },

  /**
   * Normalize configuration value to standard format
   * @param {string} configKey - Configuration key
   * @param {string} configValue - Value to normalize
   * @returns {string} Normalized value
   */
  normalizeValue(configKey, configValue) {
    if (!configValue) return configValue;

    const parsedKey = parseConfigKey(configKey);
    
    // Boolean normalization
    if (parsedKey.parameter && parsedKey.parameter.includes('enabled') || 
        parsedKey.parameter && (parsedKey.parameter.includes('alert') || 
        parsedKey.parameter.includes('report') || parsedKey.parameter.includes('summary'))) {
      const lowerValue = configValue.toLowerCase().trim();
      if (['true', '1', 'yes', 'on', 'enable', 'enabled'].includes(lowerValue)) {
        return 'true';
      }
      if (['false', '0', 'no', 'off', 'disable', 'disabled'].includes(lowerValue)) {
        return 'false';
      }
    }

    // Numeric normalization  
    if (parsedKey.parameter && (parsedKey.parameter.includes('port') || 
        parsedKey.parameter.includes('timeout') || parsedKey.parameter.includes('size') ||
        parsedKey.parameter.includes('attempts'))) {
      const numericValue = configValue.replace(/[^\d]/g, '');
      if (numericValue) {
        return numericValue;
      }
    }

    // Hostname normalization
    if (parsedKey.parameter === 'host') {
      return configValue.toLowerCase().trim();
    }

    // Rate limit normalization
    if (parsedKey.parameter === 'rate_limit') {
      const normalized = configValue.toLowerCase().trim();
      // Ensure proper format: number/unit
      const match = normalized.match(/^(\d+)\s*\/\s*(second|minute|hour)s?$/);
      if (match) {
        return `${match[1]}/${match[2]}`;
      }
    }

    return configValue.trim();
  },

  /**
   * Get suggested values for a configuration parameter
   * @param {string} configKey - Configuration key
   * @returns {Array} Array of suggested values
   */
  getSuggestions(configKey) {
    const rule = this.getValidationRule(configKey);
    return rule?.examples || [];
  },

  /**
   * Get human-readable description for configuration parameter
   * @param {string} configKey - Configuration key
   * @returns {string} Description or null if not found
   */
  getDescription(configKey) {
    const rule = this.getValidationRule(configKey);
    return rule?.description || null;
  }
};

/**
 * Input parsing and token recognition utilities
 */
export const InputParser = {
  /**
   * Parse yes/no responses from user input
   * @param {string} input - User input to parse
   * @returns {boolean|null} True for yes, false for no, null for ambiguous
   */
  parseYesNo(input) {
    if (!input || typeof input !== 'string') {
      return null;
    }

    const normalized = input.toLowerCase().trim();
    
    // Positive responses (Indonesian and English)
    const yesTokens = [
      'yes', 'ya', 'iya', 'y', 'ok', 'okay', 'setuju', 'benar', 'betul', 
      'modify', 'change', 'ubah', 'ganti', 'lanjut', 'proceed', 'continue'
    ];
    
    // Negative responses (Indonesian and English)
    const noTokens = [
      'no', 'tidak', 'n', 'batal', 'cancel', 'stop', 'tolak', 'skip', 
      'lewat', 'tidak usah', 'ga', 'gak', 'engga', 'enggak'
    ];

    if (yesTokens.includes(normalized)) {
      return true;
    }

    if (noTokens.includes(normalized)) {
      return false;
    }

    return null; // Ambiguous response
  },

  /**
   * Parse numeric selection from user input
   * @param {string} input - User input to parse
   * @param {number} maxValue - Maximum valid selection value
   * @returns {number|null} Selected number or null if invalid
   */
  parseSelection(input, maxValue) {
    if (!input || typeof input !== 'string') {
      return null;
    }

    const normalized = input.trim();
    const number = parseInt(normalized, 10);

    if (isNaN(number) || number < 1 || number > maxValue) {
      return null;
    }

    return number;
  },

  /**
   * Parse extension request from user input
   * @param {string} input - User input to parse
   * @returns {boolean} True if extension requested
   */
  parseExtensionRequest(input) {
    if (!input || typeof input !== 'string') {
      return false;
    }

    const normalized = input.toLowerCase().trim();
    const extensionTokens = [
      'extend', 'extension', 'perpanjang', 'tambah waktu', 'lanjut', 
      'more time', 'tambahin', 'extra time'
    ];

    return extensionTokens.some(token => normalized.includes(token));
  },

  /**
   * Clean and prepare user input for validation
   * @param {string} input - Raw user input
   * @returns {string} Cleaned input
   */
  cleanInput(input) {
    if (!input || typeof input !== 'string') {
      return '';
    }

    return input.trim().replace(/\s+/g, ' ');
  }
};

/**
 * Expert system for providing configuration guidance
 */
export const ConfigGuidance = {
  /**
   * Get configuration recommendations based on common use cases
   * @param {string} configGroup - Configuration group
   * @returns {Object} Recommended configuration values
   */
  getRecommendations(configGroup) {
    const recommendations = {
      [CONFIG_GROUPS.CONNECTION]: {
        production: {
          'connection.ssl_enabled': 'true',
          'connection.timeout': '30000',
          'connection.port': '443'
        },
        development: {
          'connection.ssl_enabled': 'false',
          'connection.timeout': '60000',
          'connection.port': '8080'
        }
      },
      [CONFIG_GROUPS.MESSAGE_HANDLING]: {
        'high_volume': {
          'message_handling.max_queue_size': '5000',
          'message_handling.retry_attempts': '5',
          'message_handling.rate_limit': '60/minute'
        },
        'standard': {
          'message_handling.max_queue_size': '1000',
          'message_handling.retry_attempts': '3',
          'message_handling.rate_limit': '40/minute'
        }
      }
    };

    return recommendations[configGroup] || {};
  },

  /**
   * Detect configuration conflicts or warnings
   * @param {Object} configChanges - Configuration changes to check
   * @returns {Array} Array of warnings or conflicts
   */
  detectConflicts(configChanges) {
    const warnings = [];

    // Check for SSL/port mismatches
    if (configChanges['connection.ssl_enabled'] === 'true' && 
        configChanges['connection.port'] === '80') {
      warnings.push({
        type: 'warning',
        message: 'SSL enabled with port 80 - consider using port 443 for HTTPS'
      });
    }

    // Check for timeout/retry conflicts
    if (configChanges['connection.timeout'] && configChanges['message_handling.retry_attempts']) {
      const timeout = parseInt(configChanges['connection.timeout']);
      const retries = parseInt(configChanges['message_handling.retry_attempts']);
      
      if (timeout < 10000 && retries > 3) {
        warnings.push({
          type: 'warning', 
          message: 'Short timeout with high retry attempts may cause performance issues'
        });
      }
    }

    return warnings;
  }
};

// Export all components
export {
  ValidationRules,
  CommonPatterns, 
  ConfigValidator,
  InputParser,
  ConfigGuidance
};