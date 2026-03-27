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
  hasClientCustomConfiguration
} from '../service/clientConfigService.js';
import { ConfigSessionService } from '../service/configSessionService.js';
import { SESSION_STAGES } from '../model/configSessionModel.js';
import { InputParser } from '../utils/configValidator.js';
import { query } from '../db/index.js';

// Session constants
const SESSION_TIMEOUT_MINUTES = 10;
const MAX_TIMEOUT_EXTENSIONS = 2;
const CONFIGURATION_OVERVIEW_TTL_MS = 60_000;
const configurationOverviewCache = new Map();

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
    
    return {
      success: true,
      sessionId: session.session_id,
      message: clientListMessage,
      availableClients: accessibleClients.length
    };
    
  } catch (error) {
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
    
    const normalizedResponse = InputParser.parseYesNo(response);

    if (normalizedResponse === null) {
      return {
        success: false,
        error: 'INVALID_RESPONSE',
        message: 'Please respond with yes or no so the configuration workflow can continue.'
      };
    }
    
    // Handle response based on current stage
    switch (session.current_stage) {
      case SESSION_STAGES.VIEWING_CONFIG:
        if (normalizedResponse) {
          await ConfigSessionService.updateSessionStage(
            session.session_id,
            SESSION_STAGES.SELECTING_GROUP
          );
          
          return {
            success: true,
            nextStage: SESSION_STAGES.SELECTING_GROUP,
            message: await formatGroupSelectionDisplay()
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
        
      default:
        return {
          success: false,
          error: 'INVALID_STAGE_FOR_YES_NO',
          message: 'Yes/No response not expected at this stage. Please follow the workflow prompts.'
        };
    }
    
  } catch (error) {
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
    
    // Check if input is relevant to current session stage
    // This will be fully implemented in User Stories 2 and 3
    const relevantStages = ['selecting_group', 'modifying_config', 'confirming_changes'];
    
    if (!relevantStages.includes(session.current_stage)) {
      return null; // Not a configuration modification stage
    }
    
    // For now, just log and return placeholder
    logger.debug('Configuration modification input received (placeholder):', {
      phoneNumber,
      sessionId: session.session_id,
      currentStage: session.current_stage,
      inputPreview: input.substring(0, 50)
    });
    
    return {
      handled: true,
      success: false,
      inputType: 'configuration_modification',
      message: 'Configuration modification features will be available in upcoming updates.'
    };
    
  } catch (error) {
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

