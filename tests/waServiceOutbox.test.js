import { jest } from '@jest/globals';

// --- Mocks must be hoisted before any dynamic imports ---

const attachWorkerMock = jest.fn();
const createBaileysClientMock = jest.fn();

jest.unstable_mockModule('../src/service/waOutbox.js', () => ({
  attachWorker: attachWorkerMock,
  enqueueSend: jest.fn(),
  outboxQueue: { add: jest.fn() },
}));

jest.unstable_mockModule('../src/service/baileysAdapter.js', () => ({
  createBaileysClient: createBaileysClientMock,
}));

jest.unstable_mockModule('../src/db/index.js', () => ({ query: jest.fn() }));
jest.unstable_mockModule('../src/config/env.js', () => ({ env: {} }));
jest.unstable_mockModule('../src/service/waEventAggregator.js', () => ({
  handleIncoming: jest.fn(),
  getMessageDedupStats: jest.fn(() => ({ size: 0 })),
}));
jest.unstable_mockModule('../src/service/waAutoComplaintService.js', () => ({
  handleComplaintMessageIfApplicable: jest.fn().mockResolvedValue(false),
  handleConfirmationDM: jest.fn().mockResolvedValue(false),
  isGatewayComplaintForward: jest.fn().mockReturnValue(false),
  shouldHandleComplaintMessage: jest.fn().mockReturnValue(false),
}));
jest.unstable_mockModule('../src/service/waAutoSosmedTaskService.js', () => ({
  handleAutoSosmedTaskMessageIfApplicable: jest.fn().mockResolvedValue(false),
}));
jest.unstable_mockModule('../src/utils/waDiagnostics.js', () => ({
  logWaServiceDiagnostics: jest.fn(),
  checkMessageListenersAttached: jest.fn(),
}));
jest.unstable_mockModule('../src/utils/waHelper.js', () => ({
  isAdminWhatsApp: jest.fn().mockReturnValue(false),
  formatToWhatsAppId: jest.fn((v) => v),
  safeSendMessage: jest.fn(),
  getAdminWAIds: jest.fn(() => []),
  sendWAReport: jest.fn(),
}));
jest.unstable_mockModule('../src/model/userModel.js', () => ({}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// EventEmitter-based fake Baileys client
import { EventEmitter } from 'events';

let fakeClient;

beforeEach(() => {
  fakeClient = new EventEmitter();
  fakeClient.clientId = 'test-gateway';
  fakeClient.sendMessage = jest.fn().mockResolvedValue(undefined);
  fakeClient.sendSeen = jest.fn().mockResolvedValue(undefined);
  fakeClient.getState = jest.fn().mockResolvedValue('open');
  fakeClient.initialize = jest.fn().mockResolvedValue(undefined);
  fakeClient.sessionPath = '/fake/session';
  fakeClient.waitForWaReady = jest.fn().mockResolvedValue(undefined);
  fakeClient.listenerCount = jest.fn().mockReturnValue(1);

  createBaileysClientMock.mockResolvedValue(fakeClient);
  attachWorkerMock.mockClear();

  process.env.WA_SERVICE_SKIP_INIT = 'true';
  process.env.GATEWAY_WA_CLIENT_ID = 'testgateway';
});

afterEach(() => {
  jest.resetModules();
});

describe('waService — BullMQ outbox worker lifecycle', () => {
  test('attachWorker is called exactly once when the ready event fires', async () => {
    await import('../src/service/waService.js');

    // Simulate 'ready' event
    fakeClient.emit('ready');

    expect(attachWorkerMock).toHaveBeenCalledTimes(1);
    // adapter passed has a sendText function
    const adapter = attachWorkerMock.mock.calls[0][0];
    expect(typeof adapter.sendText).toBe('function');
  });

  test('attachWorker is NOT called for connecting or close states', async () => {
    await import('../src/service/waService.js');

    fakeClient.emit('change_state', 'CONNECTING');
    fakeClient.emit('disconnected', 'unknown');

    expect(attachWorkerMock).not.toHaveBeenCalled();
  });

  test('ready fired twice (reconnect) — attachWorker still called only once', async () => {
    await import('../src/service/waService.js');

    fakeClient.emit('ready');
    fakeClient.emit('ready'); // simulate reconnect

    expect(attachWorkerMock).toHaveBeenCalledTimes(1);
  });
});
