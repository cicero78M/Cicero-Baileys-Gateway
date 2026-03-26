// src/model/clientConfigModel.js
// Client Configuration Model - WhatsApp Configuration Management
// Handles configuration schema helpers and validation patterns

import { query } from '../db/index.js';

let configGroupColumnSupported;
let validationPatternColumnSupported;

/**
 * Check if config_group column exists in client_config table
 * @returns {Promise<boolean>} True if column is supported
 */
async function hasConfigGroupColumn() {
  if (configGroupColumnSupported !== undefined) {
    return configGroupColumnSupported;
  }
  
  const res = await query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_config' AND column_name = 'config_group'"
  );
  configGroupColumnSupported = res.rowCount > 0;
  return configGroupColumnSupported;
}

/**
 * Check if validation_pattern column exists in client_config table
 * @returns {Promise<boolean>} True if column is supported
 */
async function hasValidationPatternColumn() {
  if (validationPatternColumnSupported !== undefined) {
    return validationPatternColumnSupported;
  }
  
  const res = await query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_config' AND column_name = 'validation_pattern'"
  );
  validationPatternColumnSupported = res.rowCount > 0;
  return validationPatternColumnSupported;
}

/**
 * Build SELECT clause with optional new columns for backward compatibility
 * @param {string[]} columns - Base columns to select
 * @param {Object} options - Select options
 * @param {boolean} options.includeConfigGroup - Include config_group column
 * @param {boolean} options.includeValidationPattern - Include validation_pattern column
 * @returns {Promise<string>} SQL SELECT clause
 */
async function buildConfigSelect(columns, { includeConfigGroup = true, includeValidationPattern = true } = {}) {
  const selectColumns = [...columns];
  
  if (includeConfigGroup) {
    const hasConfigGroup = await hasConfigGroupColumn();
    selectColumns.push(
      hasConfigGroup ? "config_group" : "NULL::varchar AS config_group"
    );
  }
  
  if (includeValidationPattern) {
    const hasValidation = await hasValidationPatternColumn();
    selectColumns.push(
      hasValidation ? "validation_pattern" : "NULL::varchar AS validation_pattern"
    );
  }
  
  return selectColumns.join(", ");
}

/**
 * Configuration group definitions and validation
 */
export const CONFIG_GROUPS = {
  CONNECTION: 'connection',
  MESSAGE_HANDLING: 'message_handling', 
  NOTIFICATIONS: 'notifications',
  AUTOMATION_RULES: 'automation_rules',
  TEMPLATES: 'templates'
};

/**
 * Valid configuration group values
 */
export const VALID_CONFIG_GROUPS = Object.values(CONFIG_GROUPS);

/**
 * Check if a config group is valid
 * @param {string} group - Configuration group to validate
 * @returns {boolean} True if group is valid
 */
export function isValidConfigGroup(group) {
  return VALID_CONFIG_GROUPS.includes(group);
}

/**
 * Parse configuration key to extract group and parameter
 * @param {string} configKey - Configuration key in format 'group.parameter'
 * @returns {Object} Parsed key with group and parameter
 */
export function parseConfigKey(configKey) {
  const parts = configKey.split('.');
  return {
    group: parts[0] || null,
    parameter: parts.slice(1).join('.') || null,
    isValid: parts.length >= 2 && isValidConfigGroup(parts[0])
  };
}

/**
 * Build configuration key from group and parameter
 * @param {string} group - Configuration group
 * @param {string} parameter - Configuration parameter
 * @returns {string} Configuration key in format 'group.parameter'
 */
export function buildConfigKey(group, parameter) {
  if (!isValidConfigGroup(group)) {
    throw new Error(`Invalid configuration group: ${group}`);
  }
  return `${group}.${parameter}`;
}

/**
 * Configuration schema validation helpers
 */
export const ConfigurationSchema = {
  /**
   * Validate configuration value format
   * @param {string} configKey - Configuration key
   * @param {string} configValue - Configuration value
   * @param {string} validationPattern - Regex pattern for validation
   * @returns {Object} Validation result
   */
  validateValue(configKey, configValue, validationPattern) {
    if (!validationPattern) {
      return { isValid: true, error: null };
    }
    
    try {
      const regex = new RegExp(validationPattern);
      const isValid = regex.test(configValue);
      return {
        isValid,
        error: isValid ? null : `Value "${configValue}" does not match required format for ${configKey}`
      };
    } catch (error) {
      return {
        isValid: false,
        error: `Invalid validation pattern for ${configKey}: ${error.message}`
      };
    }
  },
  
  /**
   * Get display name for configuration group
   * @param {string} group - Configuration group
   * @returns {string} Human-readable group name
   */
  getGroupDisplayName(group) {
    const displayNames = {
      [CONFIG_GROUPS.CONNECTION]: 'Connection Settings',
      [CONFIG_GROUPS.MESSAGE_HANDLING]: 'Message Handling',
      [CONFIG_GROUPS.NOTIFICATIONS]: 'Notifications',
      [CONFIG_GROUPS.AUTOMATION_RULES]: 'Automation Rules',
      [CONFIG_GROUPS.TEMPLATES]: 'Message Templates'
    };
    return displayNames[group] || group;
  }
};

// Export helper functions for backward compatibility and repository usage
export { 
  hasConfigGroupColumn, 
  hasValidationPatternColumn, 
  buildConfigSelect 
};