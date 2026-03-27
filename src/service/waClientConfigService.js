/**
 * waClientConfigService.js
 * Business logic service for WhatsApp client configuration management
 * Handles client listing, selection, and Q&A workflow orchestration
 */

import { logger } from '../utils/logger.js';
import { 
  getActiveClients,
  getFormattedClientConfiguration,
  formatClientListDisplay,
  formatConfigurationDisplay,
  formatGroupSelectionDisplay,
  hasClientCustomConfiguration,
  formatChangesSummary,
  applyConfigurationChanges,
  invalidateClientCache,
  getMessageTemplates
} from '../service/clientConfigService.js';
import { ConfigSessionService } from '../service/configSessionService.js';
import { SESSION_STAGES } from '../model/configSessionModel.js';
import { CONFIG_GROUPS } from '../model/clientConfigModel.js';
import { ConfigValidator, InputParser } from '../utils/configValidator.js';
import { query } from '../db/index.js';
import { incrementWaClientConfigCounter } from './waClientConfigMetrics.js';

// Session constants
const SESSION_TIMEOUT_MINUTES = 10;
const MAX_TIMEOUT_EXTENSIONS = 2;
const CONFIGURATION_OVERVIEW_TTL_MS = 60_000;
const configurationOverviewCache = new Map();
const GROUP_SEQUENCE = [
  CONFIG_GROUPS.CONNECTION,
  CONFIG_GROUPS.MESSAGE_HANDLING,
  CONFIG_GROUPS.NOTIFICATIONS,
  CONFIG_GROUPS.AUTOMATION_RULES
];
const MODIFICATION_LOCK_STAGES = new Set([
  SESSION_STAGES.SELECTING_GROUP,
  SESSION_STAGES.MODIFYING_CONFIG,
  SESSION_STAGES.CONFIRMING_CHANGES
]);
const CANCEL_TOKENS = new Set(['cancel', 'batal', 'skip']);
const BACK_TOKENS = new Set(['back', 'kembali']);
const DONE_TOKENS = new Set(['done', 'finish', 'selesai', 'review']);

function getCachedConfigurationOverview(clientId) {
  const cached = configurationOverviewCache.get(clientId);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    configurationOverviewCache.delete(clientId);
    return null;
  }

  return cached.value;
}

function setCachedConfigurationOverview(clientId, value) {
  configurationOverviewCache.set(clientId, {
    value,
    expiresAt: Date.now() + CONFIGURATION_OVERVIEW_TTL_MS
  });
}

function buildEmptyConfigurationGroups() {
  return {
    connection: {
      displayName: 'Connection Settings',
      parameters: []
    },
    message_handling: {
      displayName: 'Message Handling',
      parameters: []
    },
    notifications: {
      displayName: 'Notifications',
      parameters: []
    },
    automation_rules: {
      displayName: 'Automation Rules',
      parameters: []
    }
  };
}

async function getConfigurationOverview(clientId) {
  const cached = getCachedConfigurationOverview(clientId);
  if (cached) {
    return cached;
  }

  const groupedConfig = await getFormattedClientConfiguration(clientId, true);
  const normalizedGroupedConfig = {
    ...buildEmptyConfigurationGroups(),
    ...groupedConfig
  };
  const message = await formatConfigurationDisplay(clientId, normalizedGroupedConfig);
  const hasCustomConfig = await hasClientCustomConfiguration(clientId);

  const overview = {
    groupedConfig: normalizedGroupedConfig,
    message,
    hasCustomConfig
  };

  setCachedConfigurationOverview(clientId, overview);
  return overview;
}

export function clearConfigurationOverviewCache() {
  configurationOverviewCache.clear();
}

function normalizeGroupedConfig(groupedConfig = {}) {
  return {
    ...buildEmptyConfigurationGroups(),
    ...JSON.parse(JSON.stringify(groupedConfig || {}))
  };
}

function getWorkingConfiguration(session) {
  const workingConfig = normalizeGroupedConfig(session.original_state);
  const pendingChanges = session.pending_changes || {};

  for (const [configKey, changeData] of Object.entries(pendingChanges)) {
    const [group, parameter] = configKey.split('.');
    if (!group || !parameter) {
      continue;
    }

    if (!workingConfig[group]) {
      workingConfig[group] = {
        displayName: formatGroupDisplayName(group),
        parameters: []
      };
    }

    const parameters = workingConfig[group].parameters || [];
    const existingParameter = parameters.find((item) => item.key === configKey);
    if (existingParameter) {
      existingParameter.value = changeData.new_value;
      continue;
    }

    parameters.push({
      key: configKey,
      parameter,
      value: changeData.new_value,
      description: ConfigValidator.getDescription(configKey),
      validationPattern: null
    });
    workingConfig[group].parameters = parameters;
  }

  return workingConfig;
}

function formatGroupDisplayName(group) {
  const displayNames = {
    [CONFIG_GROUPS.CONNECTION]: 'Connection Settings',
    [CONFIG_GROUPS.MESSAGE_HANDLING]: 'Message Handling',
    [CONFIG_GROUPS.NOTIFICATIONS]: 'Notifications',
    [CONFIG_GROUPS.AUTOMATION_RULES]: 'Automation Rules'
  };
  return displayNames[group] || group;
}

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

  return nameMap[parameterName] || parameterName.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatParameterValue(parameterName, value) {
  if (value === null || value === undefined || value === '') {
    return 'Not configured';
  }

  if (
    parameterName.includes('enabled') ||
    parameterName.includes('alert') ||
    parameterName.includes('report') ||
    parameterName.includes('summary') ||
    parameterName.includes('processing') ||
    parameterName.includes('broadcasting') ||
    parameterName.includes('response')
  ) {
    return value === 'true' ? 'Yes' : value === 'false' ? 'No' : value;
  }

  if (parameterName === 'timeout') {
    const milliseconds = parseInt(value, 10);
    if (!Number.isNaN(milliseconds)) {
      return milliseconds >= 1000 ? `${milliseconds / 1000} seconds` : `${milliseconds} milliseconds`;
    }
  }

  if (parameterName === 'rate_limit') {
    return value.replace('/', ' messages/');
  }

  return value;
}

function getCurrentGroupParameters(session) {
  if (!session.configuration_group) {
    return [];
  }

  const workingConfig = getWorkingConfiguration(session);
  return workingConfig[session.configuration_group]?.parameters || [];
}

function getSelectedParameter(session) {
  if (!session.selected_parameter_key || !session.configuration_group) {
    return null;
  }

  return getCurrentGroupParameters(session).find((parameter) => parameter.key === session.selected_parameter_key) || null;
}

async function formatParameterSelectionPrompt(session) {
  const parameters = getCurrentGroupParameters(session);
  const groupName = formatGroupDisplayName(session.configuration_group);
  const groupIcons = {
    [CONFIG_GROUPS.CONNECTION]: '🔗',
    [CONFIG_GROUPS.MESSAGE_HANDLING]: '📨',
    [CONFIG_GROUPS.NOTIFICATIONS]: '🔔',
    [CONFIG_GROUPS.AUTOMATION_RULES]: '⚙️'
  };

  const lines = parameters.map((parameter, index) => {
    const currentValue = formatParameterValue(parameter.parameter, parameter.value);
    return `${index + 1}. ${formatParameterName(parameter.parameter)}: ${currentValue}`;
  });

  return [
    `${groupIcons[session.configuration_group] || '🛠️'} ${groupName.toUpperCase()} CONFIGURATION`,
    '',
    'Current values:',
    ...lines,
    '',
    `Which parameter would you like to modify? (1-${parameters.length})`,
    'Reply "done" to review pending changes or "back" to choose another group.'
  ].join('\n');
}

function formatParameterPrompt(parameter) {
  const description = parameter.description || ConfigValidator.getDescription(parameter.key) || 'Enter a valid value for this configuration parameter.';
  const examples = ConfigValidator.getSuggestions(parameter.key).slice(0, 3);
  const currentValue = formatParameterValue(parameter.parameter, parameter.value);
  const lines = [
    `🔧 MODIFY ${formatParameterName(parameter.parameter).toUpperCase()}`,
    '',
    `Current value: ${currentValue}`,
    '',
    description
  ];

  if (examples.length > 0) {
    lines.push(`Examples: ${examples.join(', ')}`);
  }

  lines.push('');
  lines.push('Reply with the new value or reply "cancel" to return to the parameter list.');

  return lines.join('\n');
}

function formatValidationError(parameter, validationResult) {
  const suggestions = validationResult.suggestions || [];
  const lines = [
    `❌ ${validationResult.error || 'Invalid configuration value.'}`,
    '',
    `Parameter: ${formatParameterName(parameter.parameter)}`,
    'Please enter a valid value.'
  ];

  if (suggestions.length > 0) {
    lines.push(`Examples: ${suggestions.join(', ')}`);
  }

  return lines.join('\n');
}

function formatPendingChangeSuccess(parameter, newValue) {
  return [
    `✅ ${formatParameterName(parameter.parameter)} updated to: ${formatParameterValue(parameter.parameter, newValue)}`,
    '',
    'Reply "yes" to continue modifying this client or "no" to review pending changes.'
  ].join('\n');
}

function buildAppliedChangesMessage(clientId, appliedChanges) {
  const lines = Object.entries(appliedChanges).map(([configKey, value]) => {
    const parameterName = configKey.split('.').slice(1).join('.');
    return `• ${formatParameterName(parameterName)}: ${formatParameterValue(parameterName, value)}`;
  });

  return [
    '✅ CONFIGURATION UPDATED SUCCESSFULLY',
    '',
    `${clientId} configuration has been updated with ${lines.length} change${lines.length === 1 ? '' : 's'}:`,
    ...lines,
    '',
    'Changes logged for audit trail.',
    'Session completed.'
  ].join('\n');
}

async function appendExpiryWarningIfNeeded(session, message) {
  if (!session?.session_id) {
    return message;
  }

  const nearExpiry = await ConfigSessionService.isSessionNearExpiry(session.session_id);
  if (!nearExpiry) {
    return message;
  }

  return `${message}\n\n⏰ SESSION TIMEOUT WARNING\nReply "extend" to add 10 more minutes.`;
}

async function logAuditEntry({
  sessionId,
  clientId,
  phoneNumber,
  actionType,
  changeSummary,
  configKey = null,
  oldValue = null,
  newValue = null
}) {
  try {
    await query(
      `INSERT INTO client_config_audit_log (
         session_id, client_id, phone_number, action_type, config_key, old_value, new_value, change_summary, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [sessionId, clientId, phoneNumber, actionType, configKey, oldValue, newValue, changeSummary]
    );
  } catch (error) {
    logger.warn('Configuration audit log write skipped:', {
      error: error.message,
      sessionId,
      clientId,
      actionType
    });
  }
}

async function rollbackInactiveClientSession(session) {
  incrementWaClientConfigCounter('pendingRollbacks');
  await logAuditEntry({
    sessionId: session.session_id,
    clientId: session.client_id,
    phoneNumber: session.phone_number,
    actionType: 'rollback_session',
    changeSummary: `Configuration session rolled back because ${session.client_id} became inactive.`
  });

  await ConfigSessionService.rollbackSession(session.session_id, 'client_inactive');

  return {
    handled: true,
    success: false,
    error: 'CLIENT_UNAVAILABLE',
    message: `⚠️ CLIENT UNAVAILABLE\n\n${session.client_id} became inactive during configuration.\nAll pending changes have been rolled back.\n\nNo configuration changes were applied.\nSession ended.`
  };
}

async function ensureClientStillActive(session) {
  if (!session?.client_id || session.client_id === '__pending__') {
    return null;
  }

  const activeClients = await getUnrestrictedActiveClients(session.phone_number);
  const isActive = activeClients.some((client) => client.client_id === session.client_id);
  if (isActive) {
    return null;
  }

  return rollbackInactiveClientSession(session);
}

async function getConflictingModificationSessions(session) {
  const sessionsForClient = await ConfigSessionService.getSessionsByClient(session.client_id);
  return sessionsForClient.filter((candidate) =>
    candidate.phone_number !== session.phone_number &&
    MODIFICATION_LOCK_STAGES.has(candidate.current_stage)
  );
}

async function getUnrestrictedActiveClients(phoneNumber) {
  let clients = [];

  try {
    clients = await getActiveClients();
  } catch (clientListErr) {
    logger.warn('Primary getActiveClients failed. Trying fallback query:', {
      phoneNumber,
      error: clientListErr.message
    });
  }

  if (Array.isArray(clients) && clients.length > 0) {
    return clients;
  }

  try {
    const withActiveFilter = await query(
      `SELECT client_id,
              COALESCE(NULLIF(nama, ''), client_id) AS client_name
       FROM clients
       WHERE client_status = true
       ORDER BY COALESCE(NULLIF(nama, ''), client_id) ASC`
    );
    clients = normalizeClientList(withActiveFilter.rows || []);
  } catch (fallbackErr) {
    logger.warn('Fallback query with client_status failed. Trying unrestricted query:', {
      phoneNumber,
      error: fallbackErr.message
    });
  }

  if (Array.isArray(clients) && clients.length > 0) {
    return clients;
  }

  try {
    const unrestricted = await query(
      `SELECT client_id,
              COALESCE(NULLIF(nama, ''), client_id) AS client_name
       FROM clients
       ORDER BY COALESCE(NULLIF(nama, ''), client_id) ASC`
    );
    clients = normalizeClientList(unrestricted.rows || []);
  } catch (unrestrictedErr) {
    logger.error('Unrestricted clients query failed:', {
      phoneNumber,
      error: unrestrictedErr.message
    });
  }

  return normalizeClientList(clients);
}

function normalizeClientList(clients) {
  if (!Array.isArray(clients)) {
    return [];
  }

  return clients.map((client) => ({
    ...client,
    client_name: client.client_name || client.nama || client.client_id
  }));
}

/**
 * Initiate configuration session and display available clients
 * @param {string} phoneNumber - Administrator phone number
 * @returns {Promise<Object>} Session result with message
 */
export async function initiateConfigurationSession(phoneNumber) {
  try {
    // Clean up any expired sessions first (non-fatal if tables don't exist yet)
    try {
      await ConfigSessionService.cleanupExpiredSessions();
    } catch (cleanupErr) {
      logger.warn('Session cleanup skipped (tables may not exist yet):', { error: cleanupErr.message });
    }
    
    // Keep /config unrestricted: reset previous active session and start fresh.
    const existingSession = await ConfigSessionService.getActiveSession(phoneNumber);
    if (existingSession) {
      await ConfigSessionService.deleteSession(existingSession.session_id);
      logger.info('Reset existing config session for unrestricted /config access:', {
        phoneNumber,
        previousSessionId: existingSession.session_id
      });
    }
    
    const accessibleClients = await getUnrestrictedActiveClients(phoneNumber);
    
    if (accessibleClients.length === 0) {
      return {
        success: false,
        error: 'NO_ACTIVE_CLIENTS',
        message: 'No active clients available for configuration at this time.'
      };
    }
    
    // Create new configuration session (client_id set to placeholder until user selects one)
    const session = await ConfigSessionService.createSession(
      phoneNumber,
      '__pending__',
      { timeoutMs: SESSION_TIMEOUT_MINUTES * 60000 }
    );
    
    // Format message with safe fallback so initiation does not fail on formatter issues.
    let clientListMessage;
    try {
      clientListMessage = await formatClientListDisplay(accessibleClients);
    } catch (formatErr) {
      logger.warn('formatClientListDisplay failed. Using plain fallback message:', {
        phoneNumber,
        error: formatErr.message
      });

      const lines = accessibleClients.map((client, idx) => `${idx + 1}. ${client.client_name || client.client_id}`);
      clientListMessage = [
        'CONFIGURATION MANAGEMENT',
        '',
        'Select a client by replying with the number:',
        '',
        ...lines
      ].join('\n');
    }
    
    logger.info('Configuration session created:', {
      phoneNumber,
      sessionId: session.session_id,
      clientCount: accessibleClients.length
    });
    incrementWaClientConfigCounter('sessionsStarted');
    
    return {
      success: true,
      sessionId: session.session_id,
      message: clientListMessage,
      availableClients: accessibleClients.length
    };
    
  } catch (error) {
    incrementWaClientConfigCounter('errors');
    logger.error('Error initiating configuration session:', {
      error: error.message,
      stack: error.stack,
      phoneNumber
    });
    
    return {
      success: false,
      error: 'SYSTEM_ERROR',
      message: 'System temporarily unavailable. Please try again in a few minutes.'
    };
  }
}

/**
 * Process client selection from administrator input
 * @param {string} phoneNumber - Administrator phone number
 * @param {string} selection - Client selection (e.g., "1", "2")
 * @returns {Promise<Object>} Selection result with configuration display
 */
export async function processClientSelection(phoneNumber, selection) {
  try {
    // Get current session
    const session = await ConfigSessionService.getActiveSession(phoneNumber);
    if (!session) {
      return {
        success: false,
        error: 'NO_ACTIVE_SESSION',
        message: 'No active configuration session. Please start with /config command.'
      };
    }
    
    // Validate session stage
    if (session.current_stage !== SESSION_STAGES.SELECTING_CLIENT) {
      return {
        success: false,
        error: 'INVALID_STAGE',
        message: 'Invalid command for current session stage. Please follow the workflow prompts.'
      };
    }
    
    // Check session timeout
    if (new Date() > new Date(session.expires_at)) {
      await ConfigSessionService.deleteSession(session.session_id);
      return {
        success: false,
        error: 'SESSION_EXPIRED',
        message: '⏱️ SESSION EXPIRED\n\nYour configuration session has timed out. Please restart with /config command.'
      };
    }
    
    // Configuration access is intentionally unrestricted; show every active client.
    const accessibleClients = await getUnrestrictedActiveClients(phoneNumber);

    if (accessibleClients.length === 0) {
      return {
        success: false,
        error: 'NO_ACTIVE_CLIENTS',
        message: 'No active clients available for configuration at this time.'
      };
    }
    
    // Validate selection
    const selectionNumber = parseInt(selection, 10);
    if (isNaN(selectionNumber) || selectionNumber < 1 || selectionNumber > accessibleClients.length) {
      return {
        success: false,
        error: 'INVALID_SELECTION',
        message: `Invalid selection. Please reply with a number from 1 to ${accessibleClients.length}.`
      };
    }
    
    const selectedClient = accessibleClients[selectionNumber - 1];
    
    // Verify client is still active (could have become inactive during session)
    const currentActiveClients = await getUnrestrictedActiveClients(phoneNumber);
    const isStillActive = currentActiveClients.some(client => client.client_id === selectedClient.client_id);
    
    if (!isStillActive) {
      await ConfigSessionService.deleteSession(session.session_id);
      return {
        success: false,
        error: 'CLIENT_UNAVAILABLE',
        message: '⚠️ CLIENT UNAVAILABLE\n\nThe selected client became inactive during configuration. Session terminated.\n\nPlease restart with /config command.'
      };
    }
    
    // Update session with selected client
    const configurationOverview = await getConfigurationOverview(selectedClient.client_id);

    await ConfigSessionService.setViewingConfiguration(
      session.session_id,
      selectedClient.client_id,
      configurationOverview.groupedConfig
    );
    
    logger.info('Client selected for configuration:', {
      phoneNumber,
      sessionId: session.session_id,
      clientId: selectedClient.client_id,
      clientName: selectedClient.client_name
    });
    
    return {
      success: true,
      clientId: selectedClient.client_id,
      clientName: selectedClient.client_name,
      message: configurationOverview.message,
      hasCustomConfig: configurationOverview.hasCustomConfig
    };
    
  } catch (error) {
    incrementWaClientConfigCounter('errors');
    logger.error('Error processing client selection:', {
      error: error.message,
      stack: error.stack,
      phoneNumber,
      selection
    });
    
    return {
      success: false,
      error: 'SYSTEM_ERROR',
      message: 'Selection processing failed. Please try again or restart with /config.'
    };
  }
}

/**
 * Process yes/no responses for configuration modification workflow
 * @param {string} phoneNumber - Administrator phone number
 * @param {string} response - User response (yes/no/y/n)
 * @returns {Promise<Object>} Response processing result
 */
export async function processYesNoResponse(phoneNumber, response) {
  try {
    const session = await ConfigSessionService.getActiveSession(phoneNumber);
    if (!session) {
      return {
        success: false,
        error: 'NO_ACTIVE_SESSION',
        message: 'No active configuration session. Please start with /config command.'
      };
    }
    
    // Check session timeout
    if (new Date() > new Date(session.expires_at)) {
      await ConfigSessionService.deleteSession(session.session_id);
      return {
        success: false,
        error: 'SESSION_EXPIRED',
        message: '⏱️ SESSION EXPIRED\n\nYour configuration session has timed out. Please restart with /config command.'
      };
    }
    
    const yesNoDecision = InputParser.parseYesNo(response);

    if (yesNoDecision === null) {
      return {
        success: false,
        error: 'INVALID_RESPONSE',
        message: 'Please respond with yes or no so the configuration workflow can continue.'
      };
    }

    const inactiveClientResult = await ensureClientStillActive(session);
    if (inactiveClientResult) {
      return inactiveClientResult;
    }
    
    // Handle response based on current stage
    switch (session.current_stage) {
      case SESSION_STAGES.VIEWING_CONFIG:
        if (yesNoDecision) {
          const conflictingSessions = await getConflictingModificationSessions(session);
          if (conflictingSessions.length > 0) {
            return {
              success: false,
              error: 'CONFIGURATION_IN_PROGRESS',
              message: `🚦 CONFIGURATION IN PROGRESS\n\nAnother administrator is currently configuring ${session.client_id}.\n\nPlease try again shortly after the current session completes.`
            };
          }

          await ConfigSessionService.updateSessionStage(
            session.session_id,
            SESSION_STAGES.SELECTING_GROUP
          );
          
          return {
            success: true,
            nextStage: SESSION_STAGES.SELECTING_GROUP,
            message: await appendExpiryWarningIfNeeded(
              await ConfigSessionService.getActiveSession(phoneNumber),
              await formatGroupSelectionDisplay()
            )
          };
        } else {
          // User doesn't want to modify - end session
          await ConfigSessionService.deleteSession(session.session_id);
          
          return {
            success: true,
            nextStage: 'completed',
            message: `✅ CONFIGURATION REVIEW COMPLETED\n\nNo changes were made to ${session.client_id}.\nSession ended.`
          };
        }

      case SESSION_STAGES.MODIFYING_CONFIG:
        if (!session.awaiting_continue_prompt) {
          return {
            success: false,
            error: 'INVALID_STAGE_FOR_YES_NO',
            message: 'Please finish the current parameter input before responding with yes or no.'
          };
        }

        if (yesNoDecision) {
          const resumedSession = await ConfigSessionService.updateSessionStage(session.session_id, {
            awaiting_continue_prompt: false,
            selected_parameter_key: null,
            selected_parameter_index: null
          });

          return {
            success: true,
            nextStage: SESSION_STAGES.MODIFYING_CONFIG,
            message: await appendExpiryWarningIfNeeded(resumedSession, await formatParameterSelectionPrompt(resumedSession))
          };
        }

        if (!session.pending_changes || Object.keys(session.pending_changes).length === 0) {
          const resumedSession = await ConfigSessionService.updateSessionStage(session.session_id, {
            awaiting_continue_prompt: false,
            selected_parameter_key: null,
            selected_parameter_index: null
          });

          return {
            success: true,
            nextStage: SESSION_STAGES.MODIFYING_CONFIG,
            message: await appendExpiryWarningIfNeeded(
              resumedSession,
              'No configuration changes have been recorded yet.\n\nSelect another parameter to modify first.'
            )
          };
        }

        await ConfigSessionService.updateSessionStage(session.session_id, SESSION_STAGES.CONFIRMING_CHANGES, {
          awaiting_continue_prompt: false,
          selected_parameter_key: null,
          selected_parameter_index: null
        });

        return {
          success: true,
          nextStage: SESSION_STAGES.CONFIRMING_CHANGES,
          message: await appendExpiryWarningIfNeeded(
            await ConfigSessionService.getActiveSession(phoneNumber),
            await formatChangesSummary(session.client_id, session.pending_changes)
          )
        };

      case SESSION_STAGES.CONFIRMING_CHANGES:
        if (yesNoDecision) {
          const pendingChanges = session.pending_changes || {};
          const changeSet = Object.fromEntries(
            Object.entries(pendingChanges).map(([configKey, changeData]) => [configKey, changeData.new_value])
          );
          const applyResult = await applyConfigurationChanges(session.client_id, changeSet);

          if (!applyResult.success) {
            const firstError = applyResult.errors?.[0];
            return {
              success: false,
              error: 'CONFIG_APPLY_FAILED',
              message: firstError?.error || firstError?.message || 'Configuration changes could not be applied.'
            };
          }

          invalidateClientCache(session.client_id);
          clearConfigurationOverviewCache();

          for (const [configKey, changeData] of Object.entries(pendingChanges)) {
            await logAuditEntry({
              sessionId: session.session_id,
              clientId: session.client_id,
              phoneNumber: session.phone_number,
              actionType: 'modify_config',
              configKey,
              oldValue: changeData.old_value,
              newValue: changeData.new_value,
              changeSummary: `${configKey} updated via WhatsApp configuration workflow`
            });
          }

          await logAuditEntry({
            sessionId: session.session_id,
            clientId: session.client_id,
            phoneNumber: session.phone_number,
            actionType: 'confirm_changes',
            changeSummary: `${Object.keys(pendingChanges).length} configuration changes applied to ${session.client_id}.`
          });

          await ConfigSessionService.completeSession(session.session_id, changeSet);
          incrementWaClientConfigCounter('sessionsCompleted');
          incrementWaClientConfigCounter('appliedChanges', Object.keys(applyResult.appliedChanges || {}).length);

          return {
            success: true,
            nextStage: 'completed',
            message: buildAppliedChangesMessage(session.client_id, applyResult.appliedChanges)
          };
        }

        await logAuditEntry({
          sessionId: session.session_id,
          clientId: session.client_id,
          phoneNumber: session.phone_number,
          actionType: 'rollback_session',
          changeSummary: `Configuration changes discarded for ${session.client_id}.`
        });
        await ConfigSessionService.deleteSession(session.session_id);
        incrementWaClientConfigCounter('pendingRollbacks');

        return {
          success: true,
          nextStage: 'completed',
          message: `🚫 Configuration changes discarded.\n\n${session.client_id} configuration remains unchanged.\nSession ended.`
        };
        
      default:
        return {
          success: false,
          error: 'INVALID_STAGE_FOR_YES_NO',
          message: 'Yes/No response not expected at this stage. Please follow the workflow prompts.'
        };
    }
    
  } catch (error) {
    incrementWaClientConfigCounter('errors');
    logger.error('Error processing yes/no response:', {
      error: error.message,
      stack: error.stack,
      phoneNumber,
      response
    });
    
    return {
      success: false,
      error: 'SYSTEM_ERROR', 
      message: 'Response processing failed. Please try again or restart with /config.'
    };
  }
}

/**
 * Process configuration modification input (for future user stories)
 * @param {string} phoneNumber - Administrator phone number
 * @param {string} input - Configuration input
 * @returns {Promise<Object|null>} Processing result or null if not handled
 */
export async function processConfigurationModification(phoneNumber, input) {
  try {
    const session = await ConfigSessionService.getActiveSession(phoneNumber);
    if (!session) {
      return null; // No active session - not our input to handle
    }
    
    const relevantStages = [
      SESSION_STAGES.SELECTING_GROUP,
      SESSION_STAGES.MODIFYING_CONFIG,
      SESSION_STAGES.CONFIRMING_CHANGES
    ];

    if (!relevantStages.includes(session.current_stage)) {
      return null; // Not a configuration modification stage
    }

    const inactiveClientResult = await ensureClientStillActive(session);
    if (inactiveClientResult) {
      return inactiveClientResult;
    }

    const cleanedInput = InputParser.cleanInput(input);
    const normalizedInput = cleanedInput.toLowerCase();

    logger.debug('Configuration modification input received:', {
      phoneNumber,
      sessionId: session.session_id,
      currentStage: session.current_stage,
      inputPreview: cleanedInput.substring(0, 50)
    });

    if (session.current_stage === SESSION_STAGES.SELECTING_GROUP) {
      const groupSelection = InputParser.parseSelection(cleanedInput, GROUP_SEQUENCE.length);
      if (!groupSelection) {
        return {
          handled: true,
          success: false,
          error: 'INVALID_GROUP_SELECTION',
          message: `Invalid selection. Please reply with a number from 1 to ${GROUP_SEQUENCE.length}.`
        };
      }

      const conflictingSessions = await getConflictingModificationSessions(session);
      if (conflictingSessions.length > 0) {
        return {
          handled: true,
          success: false,
          error: 'CONFIGURATION_IN_PROGRESS',
          message: `🚦 CONFIGURATION IN PROGRESS\n\nAnother administrator is currently configuring ${session.client_id}.\n\nPlease wait until the active modification session is completed.`
        };
      }

      const selectedGroup = GROUP_SEQUENCE[groupSelection - 1];
      const updatedSession = await ConfigSessionService.updateSessionStage(
        session.session_id,
        SESSION_STAGES.MODIFYING_CONFIG,
        {
          configuration_group: selectedGroup,
          selected_parameter_key: null,
          selected_parameter_index: null,
          awaiting_continue_prompt: false
        }
      );

      return {
        handled: true,
        success: true,
        inputType: 'group_selection',
        nextStage: SESSION_STAGES.MODIFYING_CONFIG,
        message: await appendExpiryWarningIfNeeded(updatedSession, await formatParameterSelectionPrompt(updatedSession))
      };
    }

    if (session.current_stage === SESSION_STAGES.CONFIRMING_CHANGES) {
      return {
        handled: true,
        success: false,
        error: 'CONFIRMATION_REQUIRED',
        message: 'Please respond with yes to apply the pending changes or no to discard them.'
      };
    }

    if (session.awaiting_continue_prompt) {
      return {
        handled: true,
        success: false,
        error: 'YES_NO_REQUIRED',
        message: 'Please respond with yes to continue modifying or no to review pending changes.'
      };
    }

    if (session.selected_parameter_key) {
      const selectedParameter = getSelectedParameter(session);
      if (!selectedParameter) {
        const resetSession = await ConfigSessionService.updateSessionStage(session.session_id, {
          selected_parameter_key: null,
          selected_parameter_index: null
        });

        return {
          handled: true,
          success: false,
          error: 'PARAMETER_NOT_FOUND',
          message: await appendExpiryWarningIfNeeded(resetSession, await formatParameterSelectionPrompt(resetSession))
        };
      }

      if (CANCEL_TOKENS.has(normalizedInput) || BACK_TOKENS.has(normalizedInput)) {
        const resetSession = await ConfigSessionService.updateSessionStage(session.session_id, {
          selected_parameter_key: null,
          selected_parameter_index: null
        });

        return {
          handled: true,
          success: true,
          inputType: 'parameter_cancelled',
          nextStage: SESSION_STAGES.MODIFYING_CONFIG,
          message: await appendExpiryWarningIfNeeded(resetSession, await formatParameterSelectionPrompt(resetSession))
        };
      }

      const validationResult = ConfigValidator.validateValue(
        selectedParameter.key,
        cleanedInput,
        selectedParameter.validationPattern
      );

      if (!validationResult.isValid) {
        return {
          handled: true,
          success: false,
          error: 'INVALID_CONFIG_VALUE',
          message: await appendExpiryWarningIfNeeded(session, formatValidationError(selectedParameter, validationResult))
        };
      }

      const normalizedValue = ConfigValidator.normalizeValue(selectedParameter.key, cleanedInput);
      const updatedSession = await ConfigSessionService.addPendingChange(
        session.session_id,
        selectedParameter.key,
        selectedParameter.value ?? '',
        normalizedValue
      );

      await ConfigSessionService.updateSessionStage(session.session_id, {
        awaiting_continue_prompt: true,
        selected_parameter_key: null,
        selected_parameter_index: null
      });

      return {
        handled: true,
        success: true,
        inputType: 'parameter_value',
        nextStage: SESSION_STAGES.MODIFYING_CONFIG,
        message: await appendExpiryWarningIfNeeded(updatedSession, formatPendingChangeSuccess(selectedParameter, normalizedValue))
      };
    }

    if (BACK_TOKENS.has(normalizedInput)) {
      const resetSession = await ConfigSessionService.updateSessionStage(
        session.session_id,
        SESSION_STAGES.SELECTING_GROUP,
        {
          configuration_group: null,
          selected_parameter_key: null,
          selected_parameter_index: null
        }
      );

      return {
        handled: true,
        success: true,
        inputType: 'group_back',
        nextStage: SESSION_STAGES.SELECTING_GROUP,
        message: await appendExpiryWarningIfNeeded(resetSession, await formatGroupSelectionDisplay())
      };
    }

    if (DONE_TOKENS.has(normalizedInput)) {
      const pendingChanges = session.pending_changes || {};
      if (Object.keys(pendingChanges).length === 0) {
        return {
          handled: true,
          success: false,
          error: 'NO_PENDING_CHANGES',
          message: await appendExpiryWarningIfNeeded(
            session,
            'No configuration changes have been recorded yet.\n\nSelect a parameter to modify before reviewing changes.'
          )
        };
      }

      await ConfigSessionService.updateSessionStage(session.session_id, SESSION_STAGES.CONFIRMING_CHANGES);
      return {
        handled: true,
        success: true,
        inputType: 'review_changes',
        nextStage: SESSION_STAGES.CONFIRMING_CHANGES,
        message: await appendExpiryWarningIfNeeded(
          await ConfigSessionService.getActiveSession(phoneNumber),
          await formatChangesSummary(session.client_id, pendingChanges)
        )
      };
    }

    const currentParameters = getCurrentGroupParameters(session);
    if (currentParameters.length === 0) {
      const resetSession = await ConfigSessionService.updateSessionStage(
        session.session_id,
        SESSION_STAGES.SELECTING_GROUP,
        {
          configuration_group: null,
          selected_parameter_key: null,
          selected_parameter_index: null
        }
      );

      return {
        handled: true,
        success: false,
        error: 'EMPTY_CONFIGURATION_GROUP',
        message: await appendExpiryWarningIfNeeded(
          resetSession,
          `No parameters are available in ${formatGroupDisplayName(session.configuration_group)}.\n\nPlease choose a different configuration group.`
        )
      };
    }
    const parameterSelection = InputParser.parseSelection(cleanedInput, currentParameters.length);

    if (!parameterSelection) {
      return {
        handled: true,
        success: false,
        error: 'INVALID_PARAMETER_SELECTION',
        message: await appendExpiryWarningIfNeeded(
          session,
          `Invalid selection. Please reply with a number from 1 to ${currentParameters.length}, or reply "done" or "back".`
        )
      };
    }

    const selectedParameter = currentParameters[parameterSelection - 1];
    const updatedSession = await ConfigSessionService.updateSessionStage(session.session_id, {
      selected_parameter_key: selectedParameter.key,
      selected_parameter_index: parameterSelection - 1
    });

    return {
      handled: true,
      success: true,
      inputType: 'parameter_selection',
      nextStage: SESSION_STAGES.MODIFYING_CONFIG,
      message: await appendExpiryWarningIfNeeded(updatedSession, formatParameterPrompt(selectedParameter))
    };
    
  } catch (error) {
    incrementWaClientConfigCounter('errors');
    logger.error('Error processing configuration modification:', {
      error: error.message,
      phoneNumber,
      input: input.substring(0, 50)
    });
    
    return {
      handled: true,
      success: false,
      error: 'SYSTEM_ERROR',
      message: 'Input processing failed. Please try again or restart with /config.'
    };
  }
}

/**
 * Handle session timeout warnings and extensions
 * @param {string} phoneNumber - Administrator phone number
 * @returns {Promise<Object>} Extension result
 */
export async function handleSessionExtension(phoneNumber) {
  try {
    const session = await ConfigSessionService.getActiveSession(phoneNumber);
    if (!session) {
      return {
        success: false,
        error: 'NO_ACTIVE_SESSION',
        message: 'No active configuration session to extend.'
      };
    }
    
    // Check if extensions are allowed
    if (session.timeout_extensions >= MAX_TIMEOUT_EXTENSIONS) {
      return {
        success: false,
        error: 'MAX_EXTENSIONS_REACHED',
        message: 'Maximum session extensions reached. Please complete configuration or restart with /config.'
      };
    }
    
    // Extend session
    const extendedSession = await ConfigSessionService.extendSession(
      session.session_id,
      SESSION_TIMEOUT_MINUTES * 60000
    );
    const newExpiryTime = extendedSession?.expires_at
      ? new Date(extendedSession.expires_at)
      : null;

    if (!newExpiryTime) {
      return {
        success: false,
        error: 'SESSION_NOT_EXTENDED',
        message: 'Session extension failed. Please restart with /config.'
      };
    }
    
    return {
      success: true,
      message: `⏰ SESSION EXTENDED\n\nYour configuration session has been extended by ${SESSION_TIMEOUT_MINUTES} minutes.\n\nNew expiry time: ${newExpiryTime.toLocaleTimeString()}`,
      newExpiryTime
    };
    
  } catch (error) {
    incrementWaClientConfigCounter('errors');
    logger.error('Error handling session extension:', {
      error: error.message,
      phoneNumber
    });
    
    return {
      success: false,
      error: 'SYSTEM_ERROR',
      message: 'Session extension failed. Please try again.'
    };
  }
}

/**
 * Cancel active configuration session
 * @param {string} phoneNumber - Administrator phone number
 * @returns {Promise<Object>} Cancellation result
 */
export async function cancelConfigurationSession(phoneNumber) {
  try {
    const session = await ConfigSessionService.getActiveSession(phoneNumber);
    if (!session) {
      return {
        success: false,
        error: 'NO_ACTIVE_SESSION',
        message: 'No active configuration session to cancel.'
      };
    }
    
    await ConfigSessionService.deleteSession(session.session_id);
    incrementWaClientConfigCounter('sessionsCancelled');
    
    logger.info('Configuration session cancelled:', {
      phoneNumber,
      sessionId: session.session_id,
      stage: session.current_stage
    });
    
    return {
      success: true,
      message: '🚫 CONFIGURATION SESSION CANCELLED\n\nYour configuration session has been cancelled. No changes were made.\n\nYou can start a new session anytime with /config command.'
    };
    
  } catch (error) {
    incrementWaClientConfigCounter('errors');
    logger.error('Error cancelling configuration session:', {
      error: error.message,
      phoneNumber
    });
    
    return {
      success: false,
      error: 'SYSTEM_ERROR',
      message: 'Session cancellation failed. Please try again.'
    };
  }
}

