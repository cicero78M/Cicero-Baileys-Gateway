/**
 * waClientConfigHandler.js
 * WhatsApp handler for client configuration management commands
 * Processes /config, CONFIG, configure commands with self-messaging security
 */

import { logger } from '../utils/logger.js';
import {
  initiateConfigurationSession,
  processClientSelection,
  processConfigurationModification,
  processYesNoResponse,
  handleSessionExtension
} from '../service/waClientConfigService.js';
import { ConfigSessionService } from '../service/configSessionService.js';
import { SESSION_STAGES } from '../model/configSessionModel.js';
import { InputParser } from '../utils/configValidator.js';

// Command patterns for configuration management
const CONFIG_COMMAND_PATTERNS = [
  /^\/config$/i,
  /^CONFIG$/,
  /^configure$/i,
  /^config$/i,
  /^CONFIGURE$/
];

// Numeric selection pattern for client selection
const CLIENT_SELECTION_PATTERN = /^[1-9]\d*$/;

/**
 * Extract message text from various WhatsApp message formats
 * @param {Object} message - WhatsApp message object
 * @returns {string|null} Extracted text content
 */
function extractMessageText(message) {
  // wwebjs/Baileys adapter format (msg.body used in waService.js)
  if (message.body) {
    return message.body.trim();
  }

  // Raw Baileys nested message format
  if (message.message?.extendedTextMessage?.text) {
    return message.message.extendedTextMessage.text.trim();
  }
  if (message.message?.conversation) {
    return message.message.conversation.trim();
  }

  // Legacy fallback
  if (message.extendedTextMessage?.text) {
    return message.extendedTextMessage.text.trim();
  }
  if (message.conversation) {
    return message.conversation.trim();
  }

  return null;
}

/**
 * Extract phone number from WhatsApp JID
 * @param {string} remoteJid - WhatsApp JID (e.g., +6281234567890@s.whatsapp.net)
 * @returns {string} Phone number in international format
 */
function extractPhoneNumber(remoteJid) {
  // Strip any @suffix (@s.whatsapp.net, @c.us, @lid, etc.)
  return remoteJid.replace(/@[^@]+$/, '');
}

/**
 * Check if JID represents a direct message (not group or newsletter).
 * Uses denylist to accept @s.whatsapp.net, @c.us, and @lid (Baileys linked-device).
 * @param {string} remoteJid - WhatsApp JID
 * @returns {boolean} True if direct message
 */
function isDirectMessage(remoteJid) {
  return (
    !remoteJid.endsWith('@g.us') &&
    !remoteJid.endsWith('@newsletter') &&
    !remoteJid.endsWith('@broadcast')
  );
}

/**
 * Send WhatsApp message with error handling
 * @param {Object} sock - WhatsApp socket instance
 * @param {string} jid - Target JID
 * @param {string} text - Message text
 * @param {Object} quotedMessage - Message to quote
 * @returns {Promise<boolean>} Success status
 */
async function sendMessage(sock, jid, text, quotedMessage = null) {
  try {
    const messageOptions = { text };
    
    if (quotedMessage) {
      messageOptions.quoted = quotedMessage;
    }
    
    await sock.sendMessage(jid, messageOptions);
    return true;
  } catch (error) {
    logger.error('Failed to send WhatsApp message:', {
      error: error.message,
      jid,
      textLength: text.length
    });
    return false;
  }
}

/**
 * Main WhatsApp client configuration handler
 * Processes configuration commands with self-messaging security model
 * @param {Object} context - WhatsApp message context
 * @returns {Promise<boolean>} True if message was handled
 */
export async function waClientConfigHandler(context) {
  try {
    const { sock, remoteJid, message, isGroup } = context;
    
    // Security: Only process direct messages (not groups or newsletters)
    if (isGroup || !isDirectMessage(remoteJid)) {
      return false;
    }
    
    const messageText = extractMessageText(message);
    if (!messageText) {
      return false;
    }
    
    const phoneNumber = extractPhoneNumber(remoteJid);
    
    // Check if this is a configuration command
    const isConfigCommand = CONFIG_COMMAND_PATTERNS.some(pattern => 
      pattern.test(messageText)
    );
    
    if (isConfigCommand) {
      return await handleConfigurationInitiation(sock, remoteJid, phoneNumber, message);
    }

    const activeSession = await ConfigSessionService.getActiveSession(phoneNumber);
    if (!activeSession) {
      return false;
    }

    if (InputParser.parseExtensionRequest(messageText)) {
      return await handleExtensionRequest(sock, remoteJid, phoneNumber, message);
    }

    // Check if this is a client selection (numeric input)
    if (
      activeSession.current_stage === SESSION_STAGES.SELECTING_CLIENT &&
      CLIENT_SELECTION_PATTERN.test(messageText)
    ) {
      return await handleClientSelection(sock, remoteJid, phoneNumber, messageText, message);
    }
    
    // Check if this is a yes/no response
    if (
      activeSession.current_stage === SESSION_STAGES.VIEWING_CONFIG &&
      InputParser.parseYesNo(messageText) !== null
    ) {
      return await handleYesNoResponse(sock, remoteJid, phoneNumber, messageText, message);  
    }
    
    // Try to process as configuration modification input
    return await handleConfigurationInput(sock, remoteJid, phoneNumber, messageText, message);
    
  } catch (error) {
    logger.error('Error in waClientConfigHandler:', {
      error: error.message,
      stack: error.stack,
      remoteJid: context.remoteJid,
      messagePreview: extractMessageText(context.message)?.substring(0, 100)
    });
    
    // Send generic error message to user
    await sendMessage(
      context.sock,
      context.remoteJid,
      'System temporarily unavailable. Please try again in a few minutes.',
      context.message
    );
    
    return true; // Mark as handled to prevent further processing
  }
}

async function handleExtensionRequest(sock, remoteJid, phoneNumber, quotedMessage) {
  try {
    const extensionResult = await handleSessionExtension(phoneNumber);
    return await sendMessage(sock, remoteJid, extensionResult.message, quotedMessage);
  } catch (error) {
    logger.error('Error handling session extension:', {
      error: error.message,
      phoneNumber,
      remoteJid
    });

    await sendMessage(
      sock,
      remoteJid,
      'Session extension failed. Please try again or restart with /config.',
      quotedMessage
    );

    return true;
  }
}

/**
 * Handle configuration session initiation (/config, CONFIG, configure)
 * @param {Object} sock - WhatsApp socket
 * @param {string} remoteJid - User JID
 * @param {string} phoneNumber - User phone number
 * @param {Object} quotedMessage - Original message to quote
 * @returns {Promise<boolean>} Handler success
 */
async function handleConfigurationInitiation(sock, remoteJid, phoneNumber, quotedMessage) {
  try {
    logger.info('Processing configuration initiation:', {
      phoneNumber,
      remoteJid
    });
    
    // Initiate configuration session with client list
    const sessionResult = await initiateConfigurationSession(phoneNumber);
    
    // Send response regardless of success/failure
    const success = await sendMessage(sock, remoteJid, sessionResult.message, quotedMessage);
    
    if (sessionResult.success && sessionResult.sessionId) {
      logger.info('Configuration session initiated:', {
        phoneNumber,
        sessionId: sessionResult.sessionId,
        stage: 'selecting_client'
      });
    } else {
      logger.warn('Configuration session initiation failed:', {
        phoneNumber,
        error: sessionResult.error || 'Unknown error'
      });
    }
    
    return success;
    
  } catch (error) {
    logger.error('Error handling configuration initiation:', {
      error: error.message,
      phoneNumber,
      remoteJid
    });
    
    await sendMessage(
      sock,
      remoteJid,
      'System temporarily unavailable. Please try again in a few minutes.',
      quotedMessage
    );
    
    return true;
  }
}

/**
 * Handle client selection (numeric input like "1", "2", etc.)
 * @param {Object} sock - WhatsApp socket
 * @param {string} remoteJid - User JID
 * @param {string} phoneNumber - User phone number  
 * @param {string} selection - User input (numeric)
 * @param {Object} quotedMessage - Original message to quote
 * @returns {Promise<boolean>} Handler success
 */
async function handleClientSelection(sock, remoteJid, phoneNumber, selection, quotedMessage) {
  try {
    logger.info('Processing client selection:', {
      phoneNumber,
      selection,
      remoteJid
    });
    
    // Process client selection with session validation
    const selectionResult = await processClientSelection(phoneNumber, selection);
    
    // Send response
    const success = await sendMessage(sock, remoteJid, selectionResult.message, quotedMessage);
    
    if (selectionResult.success) {
      logger.info('Client selection processed:', {
        phoneNumber,
        selectedClient: selectionResult.clientId,
        stage: 'viewing_config'
      });
    } else {
      logger.warn('Client selection failed:', {
        phoneNumber,
        selection,
        error: selectionResult.error || 'Unknown error'
      });
    }
    
    return success;
    
  } catch (error) {
    logger.error('Error handling client selection:', {
      error: error.message,
      phoneNumber,
      selection,
      remoteJid
    });
    
    await sendMessage(
      sock,
      remoteJid,
      'Selection processing failed. Please try again or restart with /config.',
      quotedMessage
    );
    
    return true;
  }
}

/**
 * Handle yes/no responses for modification workflow
 * @param {Object} sock - WhatsApp socket
 * @param {string} remoteJid - User JID
 * @param {string} phoneNumber - User phone number
 * @param {string} response - User yes/no response
 * @param {Object} quotedMessage - Original message to quote
 * @returns {Promise<boolean>} Handler success
 */
async function handleYesNoResponse(sock, remoteJid, phoneNumber, response, quotedMessage) {
  try {
    logger.info('Processing yes/no response:', {
      phoneNumber,
      response: response.toLowerCase(),
      remoteJid
    });
    
    // Process yes/no response based on current session state
    const responseResult = await processYesNoResponse(phoneNumber, response.toLowerCase());
    
    // Send response
    const success = await sendMessage(sock, remoteJid, responseResult.message, quotedMessage);
    
    if (responseResult.success) {
      logger.info('Yes/No response processed:', {
        phoneNumber,
        response: response.toLowerCase(),
        nextStage: responseResult.nextStage
      }); 
    }
    
    return success;
    
  } catch (error) {
    logger.error('Error handling yes/no response:', {
      error: error.message,
      phoneNumber,
      response,
      remoteJid
    });
    
    await sendMessage(
      sock,
      remoteJid,
      'Response processing failed. Please try again or restart with /config.',
      quotedMessage
    );
    
    return true;
  }
}

/**
 * Handle configuration modification input (parameter values, group selections, etc.)
 * @param {Object} sock - WhatsApp socket
 * @param {string} remoteJid - User JID
 * @param {string} phoneNumber - User phone number
 * @param {string} input - User configuration input
 * @param {Object} quotedMessage - Original message to quote
 * @returns {Promise<boolean>} Handler success
 */
async function handleConfigurationInput(sock, remoteJid, phoneNumber, input, quotedMessage) {
  try {
    // Only process if there's an active configuration session
    // This will be implemented in subsequent user stories
    logger.debug('Configuration input received (not yet implemented):', {
      phoneNumber,
      input: input.substring(0, 50),
      remoteJid
    });
    
    // Try to process as configuration modification
    const modificationResult = await processConfigurationModification(phoneNumber, input);
    
    // Only respond if this was actually a configuration input for an active session
    if (modificationResult && modificationResult.handled) {
      const success = await sendMessage(sock, remoteJid, modificationResult.message, quotedMessage);
      
      if (modificationResult.success) {
        logger.info('Configuration modification processed:', {
          phoneNumber,
          inputType: modificationResult.inputType,
          stage: modificationResult.nextStage
        });
      }
      
      return success;
    }
    
    // Not a configuration command - let other handlers process
    return false;
    
  } catch (error) {
    logger.error('Error handling configuration input:', {
      error: error.message,
      phoneNumber,
      input: input.substring(0, 50),
      remoteJid
    });
    
    // Only send error if this was definitely a configuration session
    // For now, return false to let other handlers try
    return false;
  }
}

export default waClientConfigHandler;
