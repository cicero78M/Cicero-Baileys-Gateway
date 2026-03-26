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
  hasClientCustomConfiguration
} from '../service/clientConfigService.js';
import {
  createConfigurationSession,
  getConfigurationSession,
  updateSessionStage,
  extendSessionTimeout,
  hasActiveSession,
  cleanupExpiredSessions,
  deleteConfigurationSession
} from '../service/configSessionService.js';
import {
  getAdministratorPermissions,
  getClientAccessScope
} from '../repository/administratorAuthorizationRepository.js';
import { v4 as uuidv4 } from 'uuid';

// Session constants
const SESSION_TIMEOUT_MINUTES = 10;
const MAX_TIMEOUT_EXTENSIONS = 2;
const WARNING_THRESHOLD_MINUTES = 2;

/**
 * Initiate configuration session and display available clients
 * @param {string} phoneNumber - Administrator phone number
 * @returns {Promise<Object>} Session result with message
 */
export async function initiateConfigurationSession(phoneNumber) {
  try {
    // Clean up any expired sessions first
    await cleanupExpiredSessions();
    
    // Check if administrator already has an active session
    const existingSession = await hasActiveSession(phoneNumber);
    if (existingSession) {
      const timeRemaining = Math.ceil((new Date(existingSession.expires_at) - new Date()) / 60000);
      
      return {
        success: false,
        error: 'ACTIVE_SESSION_EXISTS',
        sessionId: existingSession.session_id,
        message: `🔧 CONFIGURATION SESSION ACTIVE\n\nYou have an existing configuration session that expires in ${timeRemaining} minute(s).\n\nType 'cancel' to end the current session and start a new one.`
      }; 
    }
    
    // Get administrator permissions
    const adminPermissions = await getAdministratorPermissions(phoneNumber);
    if (!adminPermissions || !adminPermissions.is_authorized) {
      logger.warn('Unauthorized configuration access:', { phoneNumber });
      return {
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Unauthorized access detected.'
      };
    }
    
    // Get accessible clients based on administrator scope
    const accessibleClients = await getAccessibleClients(phoneNumber, adminPermissions);
    
    if (accessibleClients.length === 0) {
      return {
        success: false,
        error: 'NO_ACTIVE_CLIENTS',
        message: await formatNoActiveClientsMessage(adminPermissions.permission_level)
      };
    }
    
    // Create new configuration session
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_MINUTES * 60000);
    
    const session = await createConfigurationSession({
      session_id: sessionId,
      phone_number: phoneNumber,
      client_id: null, // Will be set when client is selected
      current_stage: 'selecting_client',
      configuration_group: null,
      pending_changes: {},
      original_state: {},
      timeout_extensions: 0,
      expires_at: expiresAt
    });
    
    // Format client list message
    const clientListMessage = await formatClientListDisplay(accessibleClients);
    
    logger.info('Configuration session created:', {
      phoneNumber,
      sessionId,
      clientCount: accessibleClients.length,
      permissionLevel: adminPermissions.permission_level
    });
    
    return {
      success: true,
      sessionId,
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
    const session = await getConfigurationSession(phoneNumber);
    if (!session) {
      return {
        success: false,
        error: 'NO_ACTIVE_SESSION',
        message: 'No active configuration session. Please start with /config command.'
      };
    }
    
    // Validate session stage
    if (session.current_stage !== 'selecting_client') {
      return {
        success: false,
        error: 'INVALID_STAGE',
        message: 'Invalid command for current session stage. Please follow the workflow prompts.'
      };
    }
    
    // Check session timeout
    if (new Date() > new Date(session.expires_at)) {
      await deleteConfigurationSession(session.session_id);
      return {
        success: false,
        error: 'SESSION_EXPIRED',
        message: '⏱️ SESSION EXPIRED\n\nYour configuration session has timed out. Please restart with /config command.'
      };
    }
    
    // Get accessible clients for this administrator
    const adminPermissions = await getAdministratorPermissions(phoneNumber);
    const accessibleClients = await getAccessibleClients(phoneNumber, adminPermissions);
    
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
    const currentActiveClients = await getActiveClients();
    const isStillActive = currentActiveClients.some(client => client.client_id === selectedClient.client_id);
    
    if (!isStillActive) {
      await deleteConfigurationSession(session.session_id);
      return {
        success: false,
        error: 'CLIENT_UNAVAILABLE',
        message: '⚠️ CLIENT UNAVAILABLE\n\nThe selected client became inactive during configuration. Session terminated.\n\nPlease restart with /config command.'
      };
    }
    
    // Update session with selected client
    await updateSessionStage(session.session_id, {
      client_id: selectedClient.client_id,
      current_stage: 'viewing_config'
    });
    
    // Get and format client configuration
    const clientConfig = await getFormattedClientConfiguration(selectedClient.client_id, true);
    const configDisplayMessage = await formatConfigurationDisplay(selectedClient.client_id, clientConfig);
    
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
      message: configDisplayMessage,
      hasCustomConfig: await hasClientCustomConfiguration(selectedClient.client_id)
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
    const session = await getConfigurationSession(phoneNumber);
    if (!session) {
      return {
        success: false,
        error: 'NO_ACTIVE_SESSION',
        message: 'No active configuration session. Please start with /config command.'
      };
    }
    
    // Check session timeout
    if (new Date() > new Date(session.expires_at)) {
      await deleteConfigurationSession(session.session_id);
      return {
        success: false,
        error: 'SESSION_EXPIRED',
        message: '⏱️ SESSION EXPIRED\n\nYour configuration session has timed out. Please restart with /config command.'
      };
    }
    
    const normalizedResponse = response.toLowerCase();
    const isYes = ['yes', 'y'].includes(normalizedResponse);
    const isNo = ['no', 'n'].includes(normalizedResponse);
    
    if (!isYes && !isNo) {
      return {
        success: false,
        error: 'INVALID_RESPONSE',
        message: 'Please respond with "yes" or "no" (or "y" or "n").'
      };
    }
    
    // Handle response based on current stage
    switch (session.current_stage) {
      case 'viewing_config':
        if (isYes) {
          // User wants to modify configuration - advance to group selection
          // This will be implemented in User Story 3
          await updateSessionStage(session.session_id, {
            current_stage: 'selecting_group'
          });
          
          return {
            success: true,
            nextStage: 'selecting_group',
            message: 'Configuration modification will be available in the next update. For now, session completed.\n\nThank you for using the configuration management system.'
          };
        } else {
          // User doesn't want to modify - end session
          await deleteConfigurationSession(session.session_id);
          
          return {
            success: true,
            nextStage: 'completed',
            message: '✅ CONFIGURATION REVIEW COMPLETED\n\nNo changes requested. Session ended.\n\nThank you for using the configuration management system.'
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
    const session = await getConfigurationSession(phoneNumber);
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
 * Get clients accessible to administrator based on permissions
 * @param {string} phoneNumber - Administrator phone number
 * @param {Object} adminPermissions - Administrator permission object
 * @returns {Promise<Array>} Filtered list of accessible clients
 */
async function getAccessibleClients(phoneNumber, adminPermissions) {
  const allActiveClients = await getActiveClients();
  
  if (adminPermissions.permission_level === 'full') {
    return allActiveClients;
  }
  
  if (adminPermissions.permission_level === 'specific_clients') {
    const clientAccessScope = await getClientAccessScope(phoneNumber);
    return allActiveClients.filter(client => 
      clientAccessScope.includes(client.client_id)
    );
  }
  
  if (adminPermissions.permission_level === 'readonly') {
    // Readonly administrators can view but not modify
    return allActiveClients;
  }
  
  return [];
}

/**
 * Format message for no active clients scenario
 * @param {string} permissionLevel - Administrator permission level
 * @returns {Promise<string>} Formatted message
 */
async function formatNoActiveClientsMessage(permissionLevel) {
  let message = '⚠️ CLIENT CONFIGURATION MANAGEMENT\n\n';
  
  if (permissionLevel === 'specific_clients') {
    message += 'No active clients available in your access scope at this time.\n\n';
    message += 'Contact your system administrator if you need access to additional clients.';
  } else {
    message += 'No active clients available for configuration at this time.\n\n';
    message += 'Please ensure at least one client is running and try again.';
  }
  
  return message;
}

/**
 * Handle session timeout warnings and extensions
 * @param {string} phoneNumber - Administrator phone number
 * @returns {Promise<Object>} Extension result
 */
export async function handleSessionExtension(phoneNumber) {
  try {
    const session = await getConfigurationSession(phoneNumber);
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
    const newExpiryTime = await extendSessionTimeout(session.session_id, SESSION_TIMEOUT_MINUTES);
    
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
    const session = await getConfigurationSession(phoneNumber);
    if (!session) {
      return {
        success: false,
        error: 'NO_ACTIVE_SESSION',
        message: 'No active configuration session to cancel.'
      };
    }
    
    await deleteConfigurationSession(session.session_id);
    
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