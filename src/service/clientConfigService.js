/**
 * clientConfigService.js
 * In-memory cached config service with lazy TTL and proactive eviction.
 * Wraps clientConfigRepository with a per-(clientId+configKey) cache.
 * Extended for WhatsApp Configuration Management Q&A workflow.
 */

import { query } from '../db/postgres.js';
import {
  getConfigValueWithDefault,
  setConfigValue as repoSetConfigValue,
  getClientConfigurationGrouped,
  setMultipleConfigValues,
  getTemplateMessages,
  hasCustomConfiguration
} from '../repository/clientConfigRepository.js';
import { CONFIG_GROUPS, ConfigurationSchema } from '../model/clientConfigModel.js';
import { ConfigValidator } from '../utils/configValidator.js';

const TTL_MS = 60_000;          // 60 s hard expiry per entry
const EVICTION_INTERVAL_MS = 120_000; // 120 s proactive sweep

/** @type {Map<string, { value: string|null, expiresAt: number }>} */
const cache = new Map();

let evictionTimer = null;

function startCacheEviction() {
  if (evictionTimer !== null) return;
  evictionTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) {
        cache.delete(key);
      }
    }
  }, EVICTION_INTERVAL_MS);

  // Don't hold the Node process open during tests
  if (evictionTimer.unref) evictionTimer.unref();
}

/**
 * Stop the background eviction timer (used in test teardown).
 */
export function stopCacheEviction() {
  if (evictionTimer !== null) {
    clearInterval(evictionTimer);
    evictionTimer = null;
  }
}

/**
 * Clear the entire in-memory cache (used in tests).
 */
export function clearCache() {
  cache.clear();
}

startCacheEviction();

/**
 * Build a deterministic cache key.
 * @param {string} clientId
 * @param {string} configKey
 * @returns {string}
 */
function cacheKey(clientId, configKey) {
  return `${clientId}::${configKey}`;
}

/**
 * A minimal pool proxy that delegates to the module-level `query` function,
 * allowing repository functions that take a pool object to work with the
 * shared connection pool.
 */
const poolProxy = {
  query: (sql, params) => query(sql, params),
};

/**
 * Get a config value for the given clientId and configKey.
 * Applies DEFAULT fallback (see getConfigValueWithDefault).
 * Result is cached for TTL_MS.
 *
 * @param {string} clientId
 * @param {string} configKey
 * @returns {Promise<string|null>}
 */
export async function getConfig(clientId, configKey) {
  const key = cacheKey(clientId, configKey);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await getConfigValueWithDefault(poolProxy, clientId, configKey);
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

/**
 * Like getConfig but returns `fallback` instead of null when no DB row found.
 *
 * @param {string} clientId
 * @param {string} configKey
 * @param {string} fallback
 * @returns {Promise<string>}
 */
export async function getConfigOrDefault(clientId, configKey, fallback) {
  const value = await getConfig(clientId, configKey);
  return value ?? fallback;
}

/**
 * Resolve which client_id owns the given WhatsApp group JID.
 * Query order:
 *  1. client_config WHERE config_key='group_jid' AND config_value=$1 → client_id
 *  2. clients table WHERE group_jid=$1 → client_id (legacy fallback)
 *  3. return null if neither found
 *
 * @param {string} groupJid
 * @returns {Promise<string|null>}
 */
export async function resolveClientIdForGroup(groupJid) {
  // 1. Check client_config table
  const confResult = await query(
    `SELECT client_id FROM client_config WHERE config_key = 'group_jid' AND config_value = $1 LIMIT 1`,
    [groupJid]
  );
  if (confResult.rows.length > 0) return confResult.rows[0].client_id;

  // 2. Legacy fallback: clients table
  const clientsResult = await query(
    `SELECT client_id FROM clients WHERE client_group = $1 LIMIT 1`,
    [groupJid]
  );
  if (clientsResult.rows.length > 0) return clientsResult.rows[0].client_id;

  return null;
}

// ============================================================================
// EXTENDED METHODS FOR WHATSAPP CONFIGURATION Q&A WORKFLOW
// ============================================================================

/**
 * Get all active clients that can be configured
 * @returns {Promise<Array>} Array of active client objects
 */
export async function getActiveClients() {
  const result = await query(
    `SELECT client_id,
            COALESCE(NULLIF(nama, ''), client_id) AS client_name,
            client_status AS status
     FROM clients 
     WHERE client_status = true
     ORDER BY COALESCE(NULLIF(nama, ''), client_id) ASC`
  );
  return result.rows;
}

/**
 * Get formatted client configuration grouped by logical sections
 * @param {string} clientId - Client ID to get configuration for
 * @param {boolean} includeDefaults - Include DEFAULT fallbacks
 * @returns {Promise<Object>} Configuration grouped by config_group
 */
export async function getFormattedClientConfiguration(clientId, includeDefaults = true) {
  const groupedConfig = await getClientConfigurationGrouped(poolProxy, clientId, includeDefaults);
  
  // Clear cache entries for this client since we're doing a full refresh
  for (const [cacheKey] of cache) {
    if (cacheKey.startsWith(`${clientId}::`)) {
      cache.delete(cacheKey);
    }
  }
  
  // Format for display with user-friendly group names
  const formatted = {};
  for (const [group, configs] of Object.entries(groupedConfig)) {
    formatted[group] = {
      displayName: ConfigurationSchema.getGroupDisplayName(group),
      parameters: configs.map(config => ({
        key: config.config_key,
        parameter: config.config_key.split('.').slice(1).join('.'),
        value: config.config_value,
        description: config.description,
        validationPattern: config.validation_pattern
      }))
    };
  }
  
  return formatted;
}

/**
 * Apply multiple configuration changes atomically 
 * @param {string} clientId - Client ID to update
 * @param {Object} configChanges - Object mapping config keys to new values
 * @returns {Promise<Object>} Result with updated entries and validation errors
 */
export async function applyConfigurationChanges(clientId, configChanges) {
  // Validate all changes first
  const validation = ConfigValidator.validateMultiple(configChanges);
  
  if (!validation.isValid) {
    return {
      success: false,
      errors: validation.results.filter(r => !r.isValid),
      appliedChanges: {}
    };
  }

  // Normalize values
  const normalizedChanges = {};
  for (const [key, value] of Object.entries(configChanges)) {
    normalizedChanges[key] = ConfigValidator.normalizeValue(key, value);
  }

  try {
    // Apply changes atomically
    const updatedEntries = await setMultipleConfigValues(poolProxy, clientId, normalizedChanges);
    
    // Clear affected cache entries
    for (const configKey of Object.keys(normalizedChanges)) {
      const key = cacheKey(clientId, configKey);
      cache.delete(key);
    }

    return {
      success: true,
      errors: [],
      appliedChanges: normalizedChanges,
      updatedEntries
    };
    
  } catch (error) {
    return {
      success: false,
      errors: [{ error: error.message, configKey: null }],
      appliedChanges: {}
    };
  }
}

/**
 * Get configuration templates for WhatsApp message display
 * @returns {Promise<Object>} Template messages for Q&A workflow
 */
export async function getMessageTemplates() {
  const templates = await getTemplateMessages(poolProxy);
  
  // Provide default templates if not found
  const defaultTemplates = {
    client_list_header: '🔧 CLIENT CONFIGURATION MANAGEMENT\n\nAvailable active clients:',
    config_display_header: '📋 CURRENT CONFIGURATION',
    modification_prompt: 'Would you like to modify any configuration settings? (yes/no)',
    group_selection_header: '🛠️ CONFIGURATION MODIFICATION\n\nWhich configuration group would you like to modify?',
    changes_summary_header: '📝 CONFIGURATION CHANGES SUMMARY',
    success_message: '✅ CONFIGURATION UPDATED SUCCESSFULLY',
    rollback_message: '🚫 Configuration changes discarded.',
    session_timeout_warning: '⏰ SESSION TIMEOUT WARNING\n\nYour configuration session expires in 2 minutes.',
    session_expired: '⏱️ SESSION EXPIRED\n\nYour configuration session has timed out.',
    unauthorized_access: 'Unauthorized access attempt detected.',
    no_active_clients: '⚠️ CLIENT CONFIGURATION MANAGEMENT\n\nNo active clients available for configuration at this time.',
    client_unavailable: '⚠️ CLIENT UNAVAILABLE\n\nThe selected client became inactive during configuration.',
    concurrent_access: '🚦 CONFIGURATION IN PROGRESS\n\nAnother administrator is currently configuring this client.'
  };

  return { ...defaultTemplates, ...templates };
}

/**
 * Format configuration display message for WhatsApp
 * @param {string} clientId - Client ID
 * @param {Object} groupedConfig - Grouped configuration data
 * @returns {Promise<string>} Formatted configuration message
 */
export async function formatConfigurationDisplay(clientId, groupedConfig) {
  const templates = await getMessageTemplates();
  
  let message = `${templates.config_display_header} - ${clientId}\n\n`;
  const groupIcons = {
    [CONFIG_GROUPS.CONNECTION]: '🔗',
    [CONFIG_GROUPS.MESSAGE_HANDLING]: '📨',
    [CONFIG_GROUPS.NOTIFICATIONS]: '🔔',
    [CONFIG_GROUPS.AUTOMATION_RULES]: '⚙️'
  };
  
  // Define display order for groups
  const displayOrder = [
    CONFIG_GROUPS.CONNECTION,
    CONFIG_GROUPS.MESSAGE_HANDLING, 
    CONFIG_GROUPS.NOTIFICATIONS,
    CONFIG_GROUPS.AUTOMATION_RULES
  ];

  for (const group of displayOrder) {
    if (groupedConfig[group]) {
      const groupData = groupedConfig[group];
      message += `${groupIcons[group] || '•'} ${groupData.displayName.toUpperCase()}:\n`;

      if (!Array.isArray(groupData.parameters) || groupData.parameters.length === 0) {
        message += '• No explicit settings configured.\n';
        message += '• Default values will be used until this section is updated.\n';
      }

      for (const param of groupData.parameters || []) {
        const displayValue = formatParameterValue(param.parameter, param.value);
        message += `• ${formatParameterName(param.parameter)}: ${displayValue}\n`;
      }
      message += '\n';
    }
  }
  
  message += templates.modification_prompt;
  return message;
}

/**
 * Format parameter name for display
 * @param {string} parameterName - Parameter name to format
 * @returns {string} Formatted parameter name
 */
function formatParameterName(parameterName) {
  const nameMap = {
    host: 'Host',
    port: 'Port', 
    ssl_enabled: 'SSL Enabled',
    timeout: 'Timeout',
    max_queue_size: 'Max Queue Size',
    retry_attempts: 'Retry Attempts',
    rate_limit: 'Rate Limit',
    status_alerts: 'Status Alerts',
    error_reports: 'Error Notifications', 
    daily_summary: 'Daily Reports',
    auto_response: 'Auto-Response',
    complaint_processing: 'Complaint Processing',
    task_broadcasting: 'Task Broadcasting'
  };
  
  return nameMap[parameterName] || parameterName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Format parameter value for display
 * @param {string} parameterName - Parameter name
 * @param {string} value - Parameter value
 * @returns {string} Formatted value
 */
function formatParameterValue(parameterName, value) {
  // Boolean formatting
  if (parameterName.includes('enabled') || parameterName.includes('alert') || 
      parameterName.includes('report') || parameterName.includes('summary') ||
      parameterName.includes('processing') || parameterName.includes('broadcasting') ||
      parameterName.includes('response')) {
    return value === 'true' ? 'Yes' : 'No';
  }

  // Timeout formatting  
  if (parameterName === 'timeout') {
    const ms = parseInt(value);
    return ms >= 1000 ? `${ms / 1000} seconds` : `${ms} milliseconds`;
  }

  // Rate limit formatting
  if (parameterName === 'rate_limit') {
    return `${value.replace('/', ' messages/')}`;
  }

  return value;
}

/**
 * Format client list message for WhatsApp
 * @param {Array} activeClients - Array of active client objects
 * @returns {Promise<string>} Formatted client list message
 */
export async function formatClientListDisplay(activeClients) {
  const templates = await getMessageTemplates();
  
  if (activeClients.length === 0) {
    return templates.no_active_clients;
  }

  let message = `${templates.client_list_header}\n`;
  
  for (let i = 0; i < activeClients.length; i++) {
    const client = activeClients[i];
    message += `${i + 1}. ${client.client_id}`;
    if (client.client_name && client.client_name !== client.client_id) {
      message += ` (${client.client_name})`;
    }
    message += '\n';
  }
  
  message += `\nReply with the number (1-${activeClients.length}) to select a client for configuration.\n\n`;
  message += 'Session expires in 10 minutes.';
  
  return message;
}

/**
 * Format configuration group selection message
 * @returns {Promise<string>} Formatted group selection message
 */
export async function formatGroupSelectionDisplay() {
  const templates = await getMessageTemplates();
  
  const message = `${templates.group_selection_header}

1. CONNECTION SETTINGS
2. MESSAGE HANDLING
3. NOTIFICATIONS  
4. AUTOMATION RULES

Reply with the number (1-4) to select a group.`;

  return message;
}

/**
 * Format changes summary message for confirmation
 * @param {string} clientId - Client ID being modified
 * @param {Object} pendingChanges - Pending configuration changes
 * @returns {Promise<string>} Formatted changes summary
 */
export async function formatChangesSummary(clientId, pendingChanges) {
  const templates = await getMessageTemplates();
  
  let message = `${templates.changes_summary_header}\n\n${clientId} - Pending Changes:\n`;
  
  for (const [configKey, changeData] of Object.entries(pendingChanges)) {
    const parameterName = configKey.split('.').slice(1).join('.');
    const displayName = formatParameterName(parameterName);
    const oldValue = formatParameterValue(parameterName, changeData.old_value);
    const newValue = formatParameterValue(parameterName, changeData.new_value);
    
    message += `• ${displayName}: ${oldValue} → ${newValue}\n`;
  }
  
  message += '\nApply these changes? (yes/no)\n\n';
  message += '⚠️ Changes will take effect immediately and may require client restart.';
  
  return message;
}

/**
 * Check if client has custom configuration overrides
 * @param {string} clientId - Client ID to check
 * @returns {Promise<boolean>} True if client has custom configurations
 */
export async function hasClientCustomConfiguration(clientId) {
  return await hasCustomConfiguration(poolProxy, clientId);
}

/**
 * Invalidate cache entries for a client (used after configuration changes)
 * @param {string} clientId - Client ID to invalidate cache for
 */
export function invalidateClientCache(clientId) {
  for (const [key] of cache) {
    if (key.startsWith(`${clientId}::`)) {
      cache.delete(key);
    }
  }
}
