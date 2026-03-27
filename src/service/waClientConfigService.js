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
import { ConfigSessionService } from '../service/configSessionService.js';

// Session constants
const SESSION_TIMEOUT_MINUTES = 10;
const MAX_TIMEOUT_EXTENSIONS = 2;

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
    
    // Check if user already has an active session
    const existingSession = await ConfigSessionService.getActiveSession(phoneNumber);
    if (existingSession) {
      const timeRemaining = Math.ceil((new Date(existingSession.expires_at) - new Date()) / 60000);
      
      return {
        success: false,
        error: 'ACTIVE_SESSION_EXISTS',
        sessionId: existingSession.session_id,
        message: `🔧 CONFIGURATION SESSION ACTIVE\n\nYou have an existing configuration session that expires in ${timeRemaining} minute(s).\n\nType 'cancel' to end the current session and start a new one.`
      }; 
    }
    
    // Get all active clients
    const accessibleClients = await getActiveClients();
    
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
    
    // Format client list message
    const clientListMessage = await formatClientListDisplay(accessibleClients);
    
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
    if (session.current_stage !== 'selecting_client') {
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
    const accessibleClients = await getActiveClients();

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
    const currentActiveClients = await getActiveClients();
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
    await ConfigSessionService.updateSessionStage(
      session.session_id,
      'viewing_config',
      { client_id: selectedClient.client_id }
    );
    
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
          await ConfigSessionService.updateSessionStage(
            session.session_id,
            'selecting_group'
          );
          
          return {
            success: true,
            nextStage: 'selecting_group',
            message: 'Configuration modification will be available in the next update. For now, session completed.\n\nThank you for using the configuration management system.'
          };
        } else {
          // User doesn't want to modify - end session
          await ConfigSessionService.deleteSession(session.session_id);
          
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

