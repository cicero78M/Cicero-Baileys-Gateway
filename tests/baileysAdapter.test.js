import { jest } from '@jest/globals';

const listeners = {};
const mockSock = {
  ev: {
    on: jest.fn((event, handler) => {
      if (!listeners[event]) {
        listeners[event] = [];
      }
      listeners[event].push(handler);
    }),
    off: jest.fn((event, handler) => {
      if (listeners[event]) {
        const index = listeners[event].indexOf(handler);
        if (index > -1) {
          listeners[event].splice(index, 1);
        }
      }
    }),
  },
  sendMessage: jest.fn().mockResolvedValue({
    key: { id: 'abc123' },
    messageTimestamp: 1234567890,
  }),
  logout: jest.fn().mockResolvedValue(),
  end: jest.fn(),
  onWhatsApp: jest.fn().mockResolvedValue([{ exists: true, jid: '1234567890@s.whatsapp.net' }]),
  readMessages: jest.fn().mockResolvedValue(),
  user: { id: '1234567890@s.whatsapp.net', name: 'Test User' },
};

const makeWASocketMock = jest.fn(() => mockSock);
const useMultiFileAuthStateMock = jest.fn().mockResolvedValue({
  state: { creds: {}, keys: {} },
  saveCreds: jest.fn(),
});
const fetchLatestBaileysVersionMock = jest.fn().mockResolvedValue({
  version: [2, 3000, 0],
  isLatest: true,
});
const makeCacheableSignalKeyStoreMock = jest.fn((keys) => keys);

// Mock Baileys
jest.unstable_mockModule('@whiskeysockets/baileys', () => ({
  default: makeWASocketMock,
  makeWASocket: makeWASocketMock,
  DisconnectReason: {
    loggedOut: 401,
    badSession: 440,
    timedOut: 408,
  },
  useMultiFileAuthState: useMultiFileAuthStateMock,
  fetchLatestBaileysVersion: fetchLatestBaileysVersionMock,
  makeCacheableSignalKeyStore: makeCacheableSignalKeyStoreMock,
  Browsers: {
    ubuntu: (name) => ['Ubuntu', '20.04', name],
  },
  delay: jest.fn((ms) => new Promise(resolve => setTimeout(resolve, ms))),
  downloadMediaMessage: jest.fn().mockResolvedValue(Buffer.from('test-media')),
}));

// Mock @hapi/boom
jest.unstable_mockModule('@hapi/boom', () => ({
  Boom: class Boom extends Error {
    constructor(message, options) {
      super(message);
      this.output = options?.output || { statusCode: 500 };
    }
  },
}));

// Mock pino
const pinoMock = jest.fn(() => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));
jest.unstable_mockModule('pino', () => ({
  default: pinoMock,
}));

// Mock node-cache
const NodeCacheMock = jest.fn();
jest.unstable_mockModule('node-cache', () => ({
  default: NodeCacheMock,
}));

// Mock fs promises
jest.unstable_mockModule('fs/promises', () => ({
  rm: jest.fn().mockResolvedValue(),
  mkdir: jest.fn().mockResolvedValue(),
  readFile: jest.fn().mockResolvedValue(''),
  stat: jest.fn().mockResolvedValue({ size: 1024 }),
  writeFile: jest.fn().mockResolvedValue(),
}));

const { createBaileysClient } = await import('../src/service/baileysAdapter.js');

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(listeners).forEach(key => delete listeners[key]);
  delete process.env.WA_AUTH_DATA_PATH;
  delete process.env.WA_AUTH_CLEAR_SESSION_ON_REINIT;
  delete process.env.WA_DEBUG_LOGGING;
});

test('baileys adapter creates client and emits ready event', async () => {
  const client = await createBaileysClient('test-client');
  
  expect(makeWASocketMock).toHaveBeenCalled();
  expect(useMultiFileAuthStateMock).toHaveBeenCalled();
  expect(fetchLatestBaileysVersionMock).toHaveBeenCalled();
  
  const readyHandler = jest.fn();
  client.on('ready', readyHandler);
  
  // Simulate connection open
  if (listeners['connection.update']) {
    listeners['connection.update'].forEach(handler => 
      handler({ connection: 'open' })
    );
  }
  
  expect(readyHandler).toHaveBeenCalled();
});

test('baileys adapter relays messages', async () => {
  const client = await createBaileysClient();
  
  const messageHandler = jest.fn();
  client.on('message', messageHandler);
  
  const incomingMessage = {
    key: {
      remoteJid: '1234567890@s.whatsapp.net',
      id: 'msg123',
      fromMe: false,
    },
    message: {
      conversation: 'Hello, World!',
    },
    messageTimestamp: 1234567890,
  };
  
  // Trigger message listener
  if (listeners['messages.upsert']) {
    listeners['messages.upsert'].forEach(handler => 
      handler({ messages: [incomingMessage], type: 'notify' })
    );
  }
  
  expect(messageHandler).toHaveBeenCalledWith(
    expect.objectContaining({
      from: '1234567890@s.whatsapp.net',
      body: 'Hello, World!',
      id: expect.objectContaining({
        id: 'msg123',
      }),
    })
  );
});

test('baileys adapter sends text message', async () => {
  const client = await createBaileysClient();
  
  await client.sendMessage('1234567890@s.whatsapp.net', 'Test message');
  
  expect(mockSock.sendMessage).toHaveBeenCalledWith(
    '1234567890@s.whatsapp.net',
    { text: 'Test message' }
  );
});

test('baileys adapter sends media message', async () => {
  const client = await createBaileysClient();
  
  const mediaContent = {
    mimetype: 'image/jpeg',
    data: Buffer.from('test-image').toString('base64'),
    filename: 'test.jpg',
  };
  
  await client.sendMessage('1234567890@s.whatsapp.net', mediaContent);
  
  expect(mockSock.sendMessage).toHaveBeenCalledWith(
    '1234567890@s.whatsapp.net',
    expect.objectContaining({
      image: expect.any(Buffer),
      mimetype: 'image/jpeg',
    })
  );
});

test('baileys adapter handles QR code generation', async () => {
  const client = await createBaileysClient();
  
  const qrHandler = jest.fn();
  client.on('qr', qrHandler);
  
  const qrCode = 'test-qr-code-data';
  
  // Simulate QR code event
  if (listeners['connection.update']) {
    listeners['connection.update'].forEach(handler => 
      handler({ qr: qrCode })
    );
  }
  
  expect(qrHandler).toHaveBeenCalledWith(qrCode);
});

test('baileys adapter handles disconnection', async () => {
  const client = await createBaileysClient();
  
  const disconnectHandler = jest.fn();
  client.on('disconnected', disconnectHandler);
  
  // Simulate disconnection
  if (listeners['connection.update']) {
    listeners['connection.update'].forEach(handler => 
      handler({ 
        connection: 'close',
        lastDisconnect: {
          error: new Error('Connection closed'),
        },
      })
    );
  }
  
  expect(disconnectHandler).toHaveBeenCalled();
});

test('baileys adapter validates phone numbers', async () => {
  const client = await createBaileysClient();
  
  const result = await client.getNumberId('1234567890');
  
  expect(mockSock.onWhatsApp).toHaveBeenCalledWith('1234567890@s.whatsapp.net');
  expect(result).toEqual({ _serialized: '1234567890@s.whatsapp.net' });
});

test('baileys adapter marks messages as read', async () => {
  const client = await createBaileysClient();
  
  await client.sendSeen('1234567890@s.whatsapp.net');
  
  expect(mockSock.readMessages).toHaveBeenCalled();
});

test('baileys adapter handles logout', async () => {
  const client = await createBaileysClient();
  
  await client.logout();
  
  expect(mockSock.logout).toHaveBeenCalled();
});

test('baileys adapter normalizes message body from different message types', async () => {
  const client = await createBaileysClient();
  
  const messageHandler = jest.fn();
  client.on('message', messageHandler);
  
  // Test extended text message
  const extendedTextMessage = {
    key: {
      remoteJid: '1234567890@s.whatsapp.net',
      id: 'msg123',
      fromMe: false,
    },
    message: {
      extendedTextMessage: {
        text: 'Extended text message',
      },
    },
    messageTimestamp: 1234567890,
  };
  
  if (listeners['messages.upsert']) {
    listeners['messages.upsert'].forEach(handler => 
      handler({ messages: [extendedTextMessage], type: 'notify' })
    );
  }
  
  expect(messageHandler).toHaveBeenCalledWith(
    expect.objectContaining({
      body: 'Extended text message',
    })
  );
});

test('baileys adapter identifies group messages', async () => {
  const client = await createBaileysClient();
  
  const messageHandler = jest.fn();
  client.on('message', messageHandler);
  
  const groupMessage = {
    key: {
      remoteJid: '123456789@g.us',
      id: 'msg123',
      fromMe: false,
      participant: '1234567890@s.whatsapp.net',
    },
    message: {
      conversation: 'Group message',
    },
    messageTimestamp: 1234567890,
  };
  
  if (listeners['messages.upsert']) {
    listeners['messages.upsert'].forEach(handler => 
      handler({ messages: [groupMessage], type: 'notify' })
    );
  }
  
  expect(messageHandler).toHaveBeenCalledWith(
    expect.objectContaining({
      from: '123456789@g.us',
      isGroup: true,
    })
  );
});

test('baileys adapter supports listenerCount method', async () => {
  const client = await createBaileysClient();
  
  // Check that listenerCount method exists
  expect(typeof client.listenerCount).toBe('function');
  
  // Test with no listeners
  const initialCount = client.listenerCount('message');
  expect(initialCount).toBeGreaterThanOrEqual(0);
  
  // Add a listener
  const handler = jest.fn();
  client.on('message', handler);
  
  // Count should increase
  const newCount = client.listenerCount('message');
  expect(newCount).toBe(initialCount + 1);
  
  // Remove the listener
  client.off('message', handler);
  
  // Count should decrease
  const finalCount = client.listenerCount('message');
  expect(finalCount).toBe(initialCount);
});
