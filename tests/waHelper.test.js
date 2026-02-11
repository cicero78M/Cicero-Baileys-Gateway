import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

let safeSendMessage;
let isAdminWhatsApp;
let sendWAFile;
let isUnsupportedVersionError;

beforeAll(async () => {
  ({ safeSendMessage, isAdminWhatsApp, sendWAFile, isUnsupportedVersionError } = await import('../src/utils/waHelper.js'));
});

test('safeSendMessage waits for client ready', async () => {
  const waClient = new EventEmitter();
  waClient.getState = jest.fn().mockResolvedValue('INITIALIZING');
  waClient.sendMessage = jest.fn().mockResolvedValue();

  const promise = safeSendMessage(waClient, '123@c.us', 'hello');
  await Promise.resolve();
  expect(waClient.sendMessage).not.toHaveBeenCalled();
  waClient.emit('ready');
  const result = await promise;
  expect(result).toBe(true);
  expect(waClient.sendMessage).toHaveBeenCalledWith('123@c.us', 'hello', {});
});

test('safeSendMessage retries recoverable errors', async () => {
  const waClient = {
    waitForWaReady: jest.fn().mockResolvedValue(),
    sendMessage: jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(),
  };

  const result = await safeSendMessage(waClient, '123@c.us', 'hello', {
    retry: { maxAttempts: 3, baseDelayMs: 0, jitterRatio: 0 },
  });

  expect(result).toBe(true);
  expect(waClient.waitForWaReady).toHaveBeenCalledTimes(2);
  expect(waClient.sendMessage).toHaveBeenCalledTimes(2);
});

test('safeSendMessage stops on non-retryable error', async () => {
  const fatalError = new Error('invalid parameter');
  fatalError.status = 400;
  const waClient = {
    waitForWaReady: jest.fn().mockResolvedValue(),
    sendMessage: jest.fn().mockRejectedValue(fatalError),
  };

  const result = await safeSendMessage(waClient, '123@c.us', 'hello', {
    retry: { maxAttempts: 5, baseDelayMs: 0, jitterRatio: 0 },
  });

  expect(result).toBe(false);
  expect(waClient.waitForWaReady).toHaveBeenCalledTimes(1);
  expect(waClient.sendMessage).toHaveBeenCalledTimes(1);
});

test('isAdminWhatsApp recognizes various input formats', () => {
  const original = process.env.ADMIN_WHATSAPP;
  process.env.ADMIN_WHATSAPP = '6281';
  expect(isAdminWhatsApp('6281@c.us')).toBe(true);
  expect(isAdminWhatsApp('6281@s.whatsapp.net')).toBe(true);
  expect(isAdminWhatsApp('+62 81')).toBe(true);
  expect(isAdminWhatsApp('999@c.us')).toBe(false);
  process.env.ADMIN_WHATSAPP = original;
});

test('sendWAFile uses onWhatsApp when available', async () => {
  const waClient = {
    onWhatsApp: jest.fn().mockResolvedValue([{ jid: '123@s.whatsapp.net', exists: true }]),
    sendMessage: jest.fn().mockResolvedValue(),
  };
  const buffer = Buffer.from('hello');
  await sendWAFile(waClient, buffer, 'file.txt', '123@c.us', 'text/plain');
  expect(waClient.onWhatsApp).toHaveBeenCalledWith('123@c.us');
  expect(waClient.sendMessage).toHaveBeenCalledWith('123@s.whatsapp.net', {
    document: buffer,
    mimetype: 'text/plain',
    fileName: 'file.txt',
  });
});

test('sendWAFile uses Excel mime when sending .xls file', async () => {
  const waClient = {
    onWhatsApp: jest.fn().mockResolvedValue([{ jid: '123@s.whatsapp.net', exists: true }]),
    sendMessage: jest.fn().mockResolvedValue(),
  };
  const buffer = Buffer.from('excel');
  await sendWAFile(waClient, buffer, 'report.xls', '123@c.us');
  expect(waClient.sendMessage).toHaveBeenCalledWith('123@s.whatsapp.net', {
    document: buffer,
    mimetype: 'application/vnd.ms-excel',
    fileName: 'report.xls',
  });
});

test('sendWAFile accepts s.whatsapp.net wid', async () => {
  const waClient = {
    onWhatsApp: jest.fn().mockResolvedValue([{ jid: '123@s.whatsapp.net', exists: true }]),
    sendMessage: jest.fn().mockResolvedValue(),
  };
  const buffer = Buffer.from('hello');
  await sendWAFile(waClient, buffer, 'file.txt', '123@s.whatsapp.net', 'text/plain');
  expect(waClient.onWhatsApp).toHaveBeenCalledWith('123@s.whatsapp.net');
  expect(waClient.sendMessage).toHaveBeenCalledWith('123@s.whatsapp.net', {
    document: buffer,
    mimetype: 'text/plain',
    fileName: 'file.txt',
  });
});

test('sendWAFile skips onWhatsApp for group ids', async () => {
  const waClient = {
    onWhatsApp: jest.fn(),
    sendMessage: jest.fn().mockResolvedValue(),
  };
  const buffer = Buffer.from('hello');
  await sendWAFile(waClient, buffer, 'file.txt', '123@g.us', 'text/plain');
  expect(waClient.onWhatsApp).not.toHaveBeenCalled();
  expect(waClient.sendMessage).toHaveBeenCalledWith('123@g.us', {
    document: buffer,
    mimetype: 'text/plain',
    fileName: 'file.txt',
  });
});

test('isUnsupportedVersionError detects update prompts', () => {
  expect(
    isUnsupportedVersionError(
      new Error('please update whatsapp to continue')
    )
  ).toBe(true);
  expect(isUnsupportedVersionError(new Error('random error'))).toBe(false);
});

test('safeSendMessage retries after hydrating when Lid is missing', async () => {
  const lidError = new Error('Evaluation failed: Error: Lid is missing in chat table');
  const waClient = {
    waitForWaReady: jest.fn().mockResolvedValue(),
    getChat: jest.fn().mockResolvedValue({ id: { _serialized: '123@c.us' } }),
    sendMessage: jest
      .fn()
      .mockRejectedValueOnce(lidError)
      .mockResolvedValueOnce({ id: { _serialized: 'msg-123' } }),
  };

  const result = await safeSendMessage(waClient, '123@c.us', 'hello', {
    retry: { maxAttempts: 3, baseDelayMs: 0, jitterRatio: 0, maxLidRetries: 3, lidRetryDelayMs: 0 },
  });

  expect(result).toBe(true);
  expect(waClient.waitForWaReady).toHaveBeenCalledTimes(1);
  // getChat is called multiple times: during resolveChatId, before send, and after Lid error
  expect(waClient.getChat).toHaveBeenCalledWith('123@c.us');
  expect(waClient.sendMessage).toHaveBeenCalledTimes(2); // Initial attempt + retry after hydration
}, 10000);

test('safeSendMessage handles persistent Lid errors properly', async () => {
  const lidError = new Error('Evaluation failed: Error: Lid is missing in chat table');
  const waClient = {
    waitForWaReady: jest.fn().mockResolvedValue(),
    getChat: jest.fn().mockResolvedValue({ id: { _serialized: '123@c.us' } }),
    sendMessage: jest
      .fn()
      .mockRejectedValueOnce(lidError) // First attempt fails
      .mockRejectedValueOnce(lidError) // First Lid retry fails
      .mockRejectedValueOnce(lidError) // Second Lid retry fails
      .mockResolvedValueOnce({ id: { _serialized: 'msg-123' } }), // Third Lid retry succeeds
  };

  const result = await safeSendMessage(waClient, '123@c.us', 'hello', {
    retry: { maxAttempts: 3, baseDelayMs: 0, jitterRatio: 0, maxLidRetries: 3, lidRetryDelayMs: 0 },
  });

  expect(result).toBe(true);
  // sendMessage is called: initial attempt + 3 Lid retries
  expect(waClient.sendMessage).toHaveBeenCalledTimes(4);
}, 20000);

// Tests for LID-based access control functions
test('getAdminClientIds returns client IDs for admin users', async () => {
  const { getAdminClientIds } = await import('../src/utils/waHelper.js');
  
  const mockQuery = jest.fn().mockResolvedValue({
    rows: [
      { client_id: 'POLDA_JATENG' },
      { client_id: 'DITBINMAS' }
    ]
  });
  
  const originalEnv = process.env.ADMIN_WHATSAPP;
  process.env.ADMIN_WHATSAPP = '628123456789,628987654321';
  
  const result = await getAdminClientIds(mockQuery);
  
  expect(result).toEqual(['POLDA_JATENG', 'DITBINMAS']);
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('SELECT DISTINCT client_id'),
    expect.any(Array)
  );
  
  process.env.ADMIN_WHATSAPP = originalEnv;
});

test('getAdminClientIds returns empty array when no admin numbers configured', async () => {
  const { getAdminClientIds } = await import('../src/utils/waHelper.js');
  
  const mockQuery = jest.fn();
  
  const originalEnv = process.env.ADMIN_WHATSAPP;
  process.env.ADMIN_WHATSAPP = '';
  
  const result = await getAdminClientIds(mockQuery);
  
  expect(result).toEqual([]);
  expect(mockQuery).not.toHaveBeenCalled();
  
  process.env.ADMIN_WHATSAPP = originalEnv;
});

test('getAdminClientIds correctly filters null and empty client_ids', async () => {
  const { getAdminClientIds } = await import('../src/utils/waHelper.js');
  
  const mockQuery = jest.fn().mockResolvedValue({
    rows: [
      { client_id: 'POLDA_JATENG' },
      { client_id: null },
      { client_id: '' },
      { client_id: 'DITBINMAS' }
    ]
  });
  
  const originalEnv = process.env.ADMIN_WHATSAPP;
  process.env.ADMIN_WHATSAPP = '628123456789';
  
  const result = await getAdminClientIds(mockQuery);
  
  // Should only return non-null, non-empty values
  expect(result).toEqual(['POLDA_JATENG', 'DITBINMAS']);
  // Verify the query includes the filter conditions
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringMatching(/client_id IS NOT NULL/),
    expect.any(Array)
  );
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringMatching(/client_id <> ''/),
    expect.any(Array)
  );
  
  process.env.ADMIN_WHATSAPP = originalEnv;
});

test('hasSameClientIdAsAdmin returns true when user has admin client_id', async () => {
  const { hasSameClientIdAsAdmin } = await import('../src/utils/waHelper.js');
  
  const mockQuery = jest.fn()
    .mockResolvedValueOnce({
      rows: [{ client_id: 'POLDA_JATENG' }]
    })
    .mockResolvedValueOnce({
      rows: [{ '?column?': 1 }]
    });
  
  const originalEnv = process.env.ADMIN_WHATSAPP;
  process.env.ADMIN_WHATSAPP = '628123456789';
  
  const result = await hasSameClientIdAsAdmin('628111222333', mockQuery);
  
  expect(result).toBe(true);
  expect(mockQuery).toHaveBeenCalledTimes(2);
  
  process.env.ADMIN_WHATSAPP = originalEnv;
});

test('hasSameClientIdAsAdmin returns false when user has different client_id', async () => {
  const { hasSameClientIdAsAdmin } = await import('../src/utils/waHelper.js');
  
  const mockQuery = jest.fn()
    .mockResolvedValueOnce({
      rows: [{ client_id: 'POLDA_JATENG' }]
    })
    .mockResolvedValueOnce({
      rows: []
    });
  
  const originalEnv = process.env.ADMIN_WHATSAPP;
  process.env.ADMIN_WHATSAPP = '628123456789';
  
  const result = await hasSameClientIdAsAdmin('628999888777', mockQuery);
  
  expect(result).toBe(false);
  
  process.env.ADMIN_WHATSAPP = originalEnv;
});

test('hasSameClientIdAsAdmin returns false for invalid input', async () => {
  const { hasSameClientIdAsAdmin } = await import('../src/utils/waHelper.js');
  
  const mockQuery = jest.fn();
  
  const result = await hasSameClientIdAsAdmin('', mockQuery);
  
  expect(result).toBe(false);
  expect(mockQuery).not.toHaveBeenCalled();
});
