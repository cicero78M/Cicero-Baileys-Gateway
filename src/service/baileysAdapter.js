import { rm, mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  delay,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import NodeCache from 'node-cache';

// Enable debug logging only when WA_DEBUG_LOGGING is set to "true"
const debugLoggingEnabled = process.env.WA_DEBUG_LOGGING === 'true';
const ADAPTER_LABEL = 'BAILEYS-ADAPTER';

function buildStructuredLog({
  clientId,
  label = ADAPTER_LABEL,
  event,
  jid = null,
  messageId = null,
  errorCode = null,
  ...extra
}) {
  return {
    clientId,
    label,
    event,
    jid,
    messageId,
    errorCode,
    ...extra,
  };
}

function writeStructuredLog(level, payload, options = {}) {
  if (options.debugOnly && !debugLoggingEnabled) {
    return;
  }
  const message = JSON.stringify(payload);
  if (level === 'debug') {
    console.debug(message);
    return;
  }
  if (level === 'warn') {
    console.warn(message);
    return;
  }
  if (level === 'error') {
    console.error(message);
    return;
  }
  console.info(message);
}

const DEFAULT_AUTH_DATA_DIR = 'baileys_auth';
const DEFAULT_AUTH_DATA_PARENT_DIR = '.cicero';

function resolveDefaultAuthDataPath() {
  const homeDir = os.homedir?.();
  const baseDir = homeDir || process.cwd();
  return path.resolve(
    path.join(baseDir, DEFAULT_AUTH_DATA_PARENT_DIR, DEFAULT_AUTH_DATA_DIR)
  );
}

function resolveAuthDataPath() {
  const configuredPath = (process.env.WA_AUTH_DATA_PATH || '').trim();
  if (configuredPath) {
    return path.resolve(configuredPath);
  }
  return resolveDefaultAuthDataPath();
}

function shouldClearAuthSession() {
  return process.env.WA_AUTH_CLEAR_SESSION_ON_REINIT === 'true';
}

const LOGOUT_DISCONNECT_REASONS = new Set([
  DisconnectReason.loggedOut,
  DisconnectReason.badSession,
  DisconnectReason.timedOut,
]);

const SIGNAL_ERROR_PATTERNS = [
  { code: 'BAD_MAC', pattern: /bad mac/i },
  { code: 'NO_SESSION', pattern: /no session/i },
  { code: 'SESSION_ERROR', pattern: /session error/i },
];
const SIGNAL_ERROR_WINDOW_MS = 5 * 60 * 1000;
const SIGNAL_ERROR_MAX_EVENTS = 100;
const DEFAULT_SIGNAL_ERROR_REINIT_THRESHOLD = 5;
const DEFAULT_SIGNAL_ERROR_REINIT_WINDOW_MS = 60 * 1000;

function parsePositiveIntegerEnv(name, defaultValue) {
  const rawValue = (process.env[name] || '').trim();
  if (!rawValue) return defaultValue;
  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : defaultValue;
}

function shouldResetAuthSessionOnSignalError() {
  return process.env.WA_SIGNAL_ERROR_RESET_AUTH_SESSION === 'true';
}

function scheduleTimeout(callback, ms) {
  const timeout = setTimeout(callback, ms);
  timeout.unref?.();
  return timeout;
}

function createSignalErrorMetrics() {
  return {
    total: 0,
    byCode: {},
    recent: [],
    lastEventAt: null,
    lastCode: null,
    lastMessage: null,
  };
}

function redactSignalErrorMessage(message) {
  return String(message || '')
    .replace(/\b\d{8,}\b/g, '[number]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .slice(0, 240);
}

function classifySignalErrorFromArgs(args) {
  const text = args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      if (arg && typeof arg === 'object') {
        return [arg.msg, arg.message, arg.err?.message, arg.error?.message]
          .filter(Boolean)
          .join(' ');
      }
      return String(arg ?? '');
    })
    .filter(Boolean)
    .join(' ');

  if (!text) return null;
  const match = SIGNAL_ERROR_PATTERNS.find(({ pattern }) => pattern.test(text));
  if (!match) return null;
  return {
    code: match.code,
    message: redactSignalErrorMessage(text),
  };
}

function pruneSignalErrorMetrics(metrics, now = Date.now()) {
  const cutoff = now - SIGNAL_ERROR_WINDOW_MS;
  metrics.recent = metrics.recent
    .filter((entry) => entry.at >= cutoff)
    .slice(-SIGNAL_ERROR_MAX_EVENTS);
}

function recordSignalError(metrics, event) {
  const now = Date.now();
  pruneSignalErrorMetrics(metrics, now);
  metrics.total += 1;
  metrics.byCode[event.code] = (metrics.byCode[event.code] || 0) + 1;
  metrics.lastEventAt = new Date(now).toISOString();
  metrics.lastCode = event.code;
  metrics.lastMessage = event.message;
  metrics.recent.push({
    at: now,
    atIso: metrics.lastEventAt,
    code: event.code,
    message: event.message,
  });
  if (metrics.recent.length > SIGNAL_ERROR_MAX_EVENTS) {
    metrics.recent = metrics.recent.slice(-SIGNAL_ERROR_MAX_EVENTS);
  }
}

function snapshotSignalErrorMetrics(metrics) {
  pruneSignalErrorMetrics(metrics);
  return {
    total: metrics.total,
    byCode: { ...metrics.byCode },
    recentWindowMs: SIGNAL_ERROR_WINDOW_MS,
    recentCount: metrics.recent.length,
    lastEventAt: metrics.lastEventAt,
    lastCode: metrics.lastCode,
    lastMessage: metrics.lastMessage,
  };
}

/**
 * Create a Baileys client that matches the WAAdapter contract.
 * @param {string} clientId - Unique identifier for this client (e.g., 'wa-admin', 'wa-gateway-123')
 * @returns {Promise<WAAdapter>} - Promise resolving to a client with EventEmitter interface
 */
export async function createBaileysClient(clientId = 'wa-admin') {
  const authDir = path.join(resolveAuthDataPath(), `session-${clientId}`);
  
  writeStructuredLog('info', buildStructuredLog({
    clientId,
    event: 'client_creation_started',
    authDir,
  }));

  // Create auth directory if it doesn't exist
  try {
    await mkdir(authDir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }

  // Clear session if requested
  if (shouldClearAuthSession()) {
    writeStructuredLog('info', buildStructuredLog({
      clientId,
      event: 'clearing_auth_session',
    }));
    try {
      await rm(authDir, { recursive: true, force: true });
      await mkdir(authDir, { recursive: true });
    } catch (err) {
      writeStructuredLog('warn', buildStructuredLog({
        clientId,
        event: 'clear_session_failed',
        error: err.message,
      }));
    }
  }

  // Initialize auth state
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  
  // Create message retry cache
  const msgRetryCounterCache = new NodeCache();

  // Fetch latest version info
  const { version, isLatest } = await fetchLatestBaileysVersion();
  writeStructuredLog('info', buildStructuredLog({
    clientId,
    event: 'baileys_version_fetched',
    version: version.join('.'),
    isLatest,
  }));

  // Create event emitter for external listeners
  const emitter = new EventEmitter();
  
  const signalErrorMetrics = createSignalErrorMetrics();
  const signalErrorReinitThreshold = parsePositiveIntegerEnv(
    'WA_SIGNAL_ERROR_REINIT_THRESHOLD',
    DEFAULT_SIGNAL_ERROR_REINIT_THRESHOLD
  );
  const signalErrorReinitWindowMs = parsePositiveIntegerEnv(
    'WA_SIGNAL_ERROR_REINIT_WINDOW_MS',
    DEFAULT_SIGNAL_ERROR_REINIT_WINDOW_MS
  );
  let signalRecoveryInProgress = false;

  function countRecentSignalErrors(code, now = Date.now()) {
    const cutoff = now - signalErrorReinitWindowMs;
    return signalErrorMetrics.recent.filter((entry) => entry.code === code && entry.at >= cutoff).length;
  }

  function scheduleSignalErrorRecovery(signalError) {
    if (!signalErrorReinitThreshold || signalRecoveryInProgress) {
      return;
    }

    const recentCount = countRecentSignalErrors(signalError.code);
    if (recentCount < signalErrorReinitThreshold) {
      return;
    }

    const resetAuthSession = shouldResetAuthSessionOnSignalError();
    signalRecoveryInProgress = true;
    writeStructuredLog('warn', buildStructuredLog({
      clientId,
      event: 'signal_error_recovery_scheduled',
      errorCode: signalError.code,
      recentCount,
      threshold: signalErrorReinitThreshold,
      windowMs: signalErrorReinitWindowMs,
      resetAuthSession,
    }));

    scheduleTimeout(async () => {
      try {
        await reinitializeClient('signal_decrypt_error', { resetAuthSession });
      } catch (err) {
        writeStructuredLog('error', buildStructuredLog({
          clientId,
          event: 'signal_error_recovery_failed',
          errorCode: signalError.code,
          error: err.message,
        }));
      } finally {
        signalRecoveryInProgress = false;
      }
    }, 1000);
  }

  // Logger configuration
  const logger = pino({ 
    level: debugLoggingEnabled ? 'debug' : 'warn',
    hooks: {
      logMethod(args, method) {
        const signalError = classifySignalErrorFromArgs(args);
        if (signalError) {
          recordSignalError(signalErrorMetrics, signalError);
          writeStructuredLog('warn', buildStructuredLog({
            clientId,
            event: 'signal_decrypt_error',
            errorCode: signalError.code,
            error: signalError.message,
            recentCount: signalErrorMetrics.recent.length,
            total: signalErrorMetrics.total,
          }));
          scheduleSignalErrorRecovery(signalError);
        }
        return method.apply(this, args);
      },
    },
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: false,
        ignore: 'hostname,pid',
        translateTime: 'SYS:standard',
      }
    }
  });

  let sock = null;
  let connectState = 'disconnected';
  let readyFired = false;
  let qrCode = null;
  let connectionRetries = 0;
  const maxConnectionRetries = 3;

  // Internal event handlers
  let internalMessageHandler = null;
  let internalConnectionUpdateHandler = null;
  let internalCredsUpdateHandler = null;

  const registerEventListeners = () => {
    if (!sock) return;

    // Remove old handlers if they exist
    if (internalMessageHandler) {
      sock.ev.off('messages.upsert', internalMessageHandler);
    }
    if (internalConnectionUpdateHandler) {
      sock.ev.off('connection.update', internalConnectionUpdateHandler);
    }
    if (internalCredsUpdateHandler) {
      sock.ev.off('creds.update', internalCredsUpdateHandler);
    }

    // Message handler
    internalMessageHandler = async ({ messages, type }) => {
      if (type !== 'notify') return;
      
      for (const msg of messages) {
        if (!msg.message) continue;
        
        writeStructuredLog('debug', buildStructuredLog({
          clientId,
          event: 'message_received',
          jid: msg.key.remoteJid,
          messageId: msg.key.id,
          fromMe: msg.key.fromMe,
        }), { debugOnly: true });

        // Convert Baileys message to wwebjs-like format for compatibility
        const normalizedMsg = normalizeBaileysMessage(msg);
        emitter.emit('message', normalizedMsg);
      }
    };

    // Connection update handler
    internalConnectionUpdateHandler = async (update) => {
      const { connection, lastDisconnect, qr } = update;

      writeStructuredLog('debug', buildStructuredLog({
        clientId,
        event: 'connection_update',
        connection,
        hasQR: !!qr,
      }), { debugOnly: true });

      // Handle QR code
      if (qr) {
        qrCode = qr;
        emitter.emit('qr', qr);
        writeStructuredLog('info', buildStructuredLog({
          clientId,
          event: 'qr_code_generated',
        }));
      }

      // Handle connection state changes
      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error instanceof Boom
          ? !LOGOUT_DISCONNECT_REASONS.has(lastDisconnect.error.output.statusCode)
          : true;

        const reason = lastDisconnect?.error?.output?.statusCode || 'unknown';
        
        writeStructuredLog('warn', buildStructuredLog({
          clientId,
          event: 'connection_closed',
          reason,
          shouldReconnect,
          retries: connectionRetries,
        }));

        emitter.emit('disconnected', reason);
        connectState = 'disconnected';
        readyFired = false;

        if (LOGOUT_DISCONNECT_REASONS.has(lastDisconnect?.error?.output?.statusCode)) {
          writeStructuredLog('warn', buildStructuredLog({
            clientId,
            event: 'logged_out',
            reason,
          }));
          emitter.emit('auth_failure', `Logged out: ${reason}`);
          scheduleTimeout(() => reinitializeClient('logged_out', { resetAuthSession: true }), 1000);
        } else if (shouldReconnect && connectionRetries < maxConnectionRetries) {
          connectionRetries++;
          writeStructuredLog('info', buildStructuredLog({
            clientId,
            event: 'attempting_reconnect',
            attempt: connectionRetries,
          }));
          scheduleTimeout(() => reinitializeClient('connection_lost'), 5000);
        }
      } else if (connection === 'open') {
        connectState = 'connected';
        connectionRetries = 0;
        qrCode = null;
        
        writeStructuredLog('info', buildStructuredLog({
          clientId,
          event: 'connection_open',
        }));

        emitter.emit('authenticated');
        
        if (!readyFired) {
          readyFired = true;
          emitter.emit('ready');
          writeStructuredLog('info', buildStructuredLog({
            clientId,
            event: 'client_ready',
          }));
        }
      } else if (connection === 'connecting') {
        connectState = 'connecting';
        emitter.emit('change_state', 'CONNECTING');
      }
    };

    // Credentials update handler
    internalCredsUpdateHandler = saveCreds;

    // Register all handlers
    sock.ev.on('messages.upsert', internalMessageHandler);
    sock.ev.on('connection.update', internalConnectionUpdateHandler);
    sock.ev.on('creds.update', internalCredsUpdateHandler);
  };

  const initializeSocket = async () => {
    sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false, // We handle QR ourselves
      browser: Browsers.ubuntu(clientId),
      msgRetryCounterCache,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      getMessage: async (key) => {
        // Return empty message for historical messages
        return { conversation: '' };
      },
      shouldSyncHistoryMessage: () => true, // Sync all history messages by default
    });

    registerEventListeners();
  };

  const reinitializeClient = async (reason, options = {}) => {
    const { resetAuthSession = false } = options;

    writeStructuredLog('info', buildStructuredLog({
      clientId,
      event: 'reinitializing_client',
      reason,
      resetAuthSession,
    }));

    // Close existing socket
    if (sock) {
      try {
        sock.end();
      } catch (err) {
        writeStructuredLog('warn', buildStructuredLog({
          clientId,
          event: 'socket_close_error',
          error: err.message,
        }));
      }
    }

    if (resetAuthSession) {
      try {
        await rm(authDir, { recursive: true, force: true });
        await mkdir(authDir, { recursive: true });
      } catch (err) {
        writeStructuredLog('warn', buildStructuredLog({
          clientId,
          event: 'auth_session_reset_failed',
          error: err.message,
        }));
      }
    }

    // Wait a bit before reconnecting
    await delay(2000);

    // Reinitialize
    await initializeSocket();
  };

  // Initialize the socket
  await initializeSocket();

  // WAAdapter interface implementation
  const adapter = {
    // Event emitter interface
    on: (event, handler) => emitter.on(event, handler),
    once: (event, handler) => emitter.once(event, handler),
    off: (event, handler) => emitter.off(event, handler),
    removeListener: (event, handler) => emitter.removeListener(event, handler),
    removeAllListeners: (event) => emitter.removeAllListeners(event),
    listenerCount: (event) => emitter.listenerCount(event),

    // Core methods
    async initialize() {
      writeStructuredLog('info', buildStructuredLog({
        clientId,
        event: 'initialize_called',
      }));
      // Already initialized in createBaileysClient
      return true;
    },

    async destroy() {
      writeStructuredLog('info', buildStructuredLog({
        clientId,
        event: 'destroy_called',
      }));
      
      if (sock) {
        sock.end();
      }
      emitter.removeAllListeners();
      connectState = 'disconnected';
      readyFired = false;
    },

    async logout() {
      writeStructuredLog('info', buildStructuredLog({
        clientId,
        event: 'logout_called',
      }));
      
      if (sock) {
        await sock.logout();
      }
      
      // Clear auth data
      try {
        await rm(authDir, { recursive: true, force: true });
      } catch (err) {
        writeStructuredLog('warn', buildStructuredLog({
          clientId,
          event: 'logout_cleanup_error',
          error: err.message,
        }));
      }
    },

    async sendMessage(jid, content, options = {}) {
      if (!sock) {
        throw new Error('Socket not initialized');
      }

      writeStructuredLog('debug', buildStructuredLog({
        clientId,
        event: 'sending_message',
        jid,
      }), { debugOnly: true });

      try {
        // Handle different content types
        if (typeof content === 'string') {
          // Plain string → text message
          const result = await sock.sendMessage(jid, { text: content });
          return normalizeOutgoingMessage(result);
        } else if (content == null) {
          // Guard: null/undefined content — log and skip rather than crash
          writeStructuredLog('warn', buildStructuredLog({
            clientId,
            event: 'send_message_skipped_null_content',
            jid,
            error: 'sendMessage called with null/undefined content',
          }));
          return null;
        } else if (typeof content.text === 'string') {
          // Baileys-native { text: '...' } object
          const result = await sock.sendMessage(jid, { text: content.text });
          return normalizeOutgoingMessage(result);
        } else if (content.mimetype) {
          // Media message (MessageMedia-like object)
          const mediaType = getMediaType(content.mimetype);
          const mediaBuffer = Buffer.from(content.data, 'base64');
          
          const mediaMessage = {
            [mediaType]: mediaBuffer,
            mimetype: content.mimetype,
          };

          if (content.filename) {
            mediaMessage.fileName = content.filename;
          }

          if (options.caption) {
            mediaMessage.caption = options.caption;
          }

          const result = await sock.sendMessage(jid, mediaMessage);
          return normalizeOutgoingMessage(result);
        } else {
          writeStructuredLog('warn', buildStructuredLog({
            clientId,
            event: 'send_message_skipped_unknown_content',
            jid,
            error: `sendMessage called with unrecognised content type: ${typeof content}`,
          }));
          return null;
        }
      } catch (err) {
        writeStructuredLog('error', buildStructuredLog({
          clientId,
          event: 'send_message_error',
          jid,
          error: err.message,
        }));
        throw err;
      }
    },

    async sendSeen(jid) {
      if (!sock) {
        throw new Error('Socket not initialized');
      }

      try {
        await sock.readMessages([{ remoteJid: jid, id: '', fromMe: false }]);
      } catch (err) {
        writeStructuredLog('warn', buildStructuredLog({
          clientId,
          event: 'send_seen_error',
          jid,
          error: err.message,
        }));
      }
    },

    async getState() {
      return connectState;
    },

    async isReady() {
      return readyFired && connectState === 'connected';
    },

    async getNumberId(phoneNumber) {
      if (!sock) {
        return null;
      }

      try {
        // Remove any non-digit characters
        const cleanNumber = phoneNumber.replace(/\D/g, '');
        const jid = `${cleanNumber}@s.whatsapp.net`;
        
        const [result] = await sock.onWhatsApp(jid);
        return result?.exists ? { _serialized: result.jid } : null;
      } catch (err) {
        writeStructuredLog('warn', buildStructuredLog({
          clientId,
          event: 'get_number_id_error',
          phoneNumber,
          error: err.message,
        }));
        return null;
      }
    },

    // Additional properties for compatibility
    get info() {
      return sock?.user || null;
    },

    get pupPage() {
      // Not applicable for Baileys
      return null;
    },

    // Expose clientId for debugging
    get clientId() {
      return clientId;
    },

    get sessionPath() {
      return authDir;
    },

    get authDataPath() {
      return resolveAuthDataPath();
    },

    getSignalErrorMetrics() {
      return snapshotSignalErrorMetrics(signalErrorMetrics);
    },

    getSignalErrorRecoveryConfig() {
      return {
        threshold: signalErrorReinitThreshold,
        windowMs: signalErrorReinitWindowMs,
        resetAuthSession: shouldResetAuthSessionOnSignalError(),
      };
    },
  };

  return adapter;
}

/**
 * Normalize Baileys message to wwebjs-like format
 */
function normalizeBaileysMessage(baileysMsg) {
  const msg = {
    // Key information
    id: {
      id: baileysMsg.key.id,
      _serialized: baileysMsg.key.id,
      fromMe: baileysMsg.key.fromMe,
      remote: baileysMsg.key.remoteJid,
    },
    key: baileysMsg.key,
    
    // Basic properties
    from: baileysMsg.key.remoteJid,
    to: baileysMsg.key.remoteJid,
    author: baileysMsg.key.participant || baileysMsg.key.remoteJid,
    body: extractMessageBody(baileysMsg),
    type: getMessageType(baileysMsg),
    timestamp: baileysMsg.messageTimestamp || Math.floor(Date.now() / 1000),
    
    // Status
    fromMe: baileysMsg.key.fromMe,
    isStatus: baileysMsg.key.remoteJid === 'status@broadcast',
    isGroup: baileysMsg.key.remoteJid?.endsWith('@g.us') || false,
    
    // Raw message for advanced usage
    _data: baileysMsg,

    // Method to download media
    async downloadMedia() {
      try {
        const buffer = await downloadMediaMessage(
          baileysMsg,
          'buffer',
          {},
          { logger: pino({ level: 'warn' }), reuploadRequest: null }
        );
        
        const mimetype = getMimeType(baileysMsg);
        return {
          mimetype,
          data: buffer.toString('base64'),
          filename: baileysMsg.message?.documentMessage?.fileName || 'file',
        };
      } catch (err) {
        console.error('Error downloading media:', err);
        return null;
      }
    },
  };

  return msg;
}

/**
 * Extract message body text from Baileys message
 */
function extractMessageBody(msg) {
  const message = msg.message;
  if (!message) return '';

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    ''
  );
}

/**
 * Get message type
 */
function getMessageType(msg) {
  const message = msg.message;
  if (!message) return 'unknown';

  if (message.conversation || message.extendedTextMessage) return 'chat';
  if (message.imageMessage) return 'image';
  if (message.videoMessage) return 'video';
  if (message.audioMessage) return 'ptt';
  if (message.documentMessage || message.documentWithCaptionMessage) return 'document';
  if (message.stickerMessage) return 'sticker';
  if (message.locationMessage) return 'location';
  if (message.contactMessage) return 'vcard';
  
  return 'unknown';
}

/**
 * Get MIME type from message
 */
function getMimeType(msg) {
  const message = msg.message;
  if (!message) return 'application/octet-stream';

  return (
    message.imageMessage?.mimetype ||
    message.videoMessage?.mimetype ||
    message.audioMessage?.mimetype ||
    message.documentMessage?.mimetype ||
    message.documentWithCaptionMessage?.message?.documentMessage?.mimetype ||
    'application/octet-stream'
  );
}

/**
 * Get media type for sending (image, video, audio, document)
 */
function getMediaType(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return 'document';
}

/**
 * Normalize outgoing message result
 */
function normalizeOutgoingMessage(result) {
  if (!result) return null;
  
  return {
    id: {
      id: result.key?.id,
      _serialized: result.key?.id,
    },
    timestamp: result.messageTimestamp || Math.floor(Date.now() / 1000),
  };
}

export default createBaileysClient;
