import { jest } from '@jest/globals';

const clientConfigServiceMocks = {
  getActiveClients: jest.fn(),
  getFormattedClientConfiguration: jest.fn(),
  formatClientListDisplay: jest.fn(),
  formatConfigurationDisplay: jest.fn(),
  formatGroupSelectionDisplay: jest.fn(),
  hasClientCustomConfiguration: jest.fn()
};

const configSessionServiceMock = {
  cleanupExpiredSessions: jest.fn(),
  getActiveSession: jest.fn(),
  createSession: jest.fn(),
  deleteSession: jest.fn(),
  setViewingConfiguration: jest.fn(),
  updateSessionStage: jest.fn(),
  extendSession: jest.fn()
};

const dbIndexMock = {
  query: jest.fn()
};

const loggerMock = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

await jest.unstable_mockModule('../../src/service/clientConfigService.js', () => ({
  ...clientConfigServiceMocks
}));

await jest.unstable_mockModule('../../src/service/configSessionService.js', () => ({
  ConfigSessionService: configSessionServiceMock
}));

await jest.unstable_mockModule('../../src/db/index.js', () => ({
  query: dbIndexMock.query
}));

await jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: loggerMock
}));

const {
  processClientSelection,
  processYesNoResponse,
  clearConfigurationOverviewCache
} = await import('../../src/service/waClientConfigService.js');

describe('waClientConfigService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearConfigurationOverviewCache();

    clientConfigServiceMocks.getActiveClients.mockResolvedValue([
      { client_id: 'CLIENT_001', client_name: 'Production Gateway' },
      { client_id: 'CLIENT_002', client_name: 'Development Gateway' }
    ]);
    clientConfigServiceMocks.getFormattedClientConfiguration.mockResolvedValue({
      connection: {
        displayName: 'Connection Settings',
        parameters: [
          { parameter: 'host', value: 'gateway.example.com' },
          { parameter: 'port', value: '8080' }
        ]
      },
      notifications: {
        displayName: 'Notifications',
        parameters: [
          { parameter: 'status_alerts', value: 'true' }
        ]
      }
    });
    clientConfigServiceMocks.formatConfigurationDisplay.mockResolvedValue('Configuration display');
    clientConfigServiceMocks.hasClientCustomConfiguration.mockResolvedValue(true);
    clientConfigServiceMocks.formatGroupSelectionDisplay.mockResolvedValue('Group selection prompt');
    configSessionServiceMock.setViewingConfiguration.mockResolvedValue({
      session_id: 'session-1',
      current_stage: 'viewing_config'
    });
    configSessionServiceMock.updateSessionStage.mockResolvedValue({
      session_id: 'session-1',
      current_stage: 'selecting_group'
    });
    configSessionServiceMock.deleteSession.mockResolvedValue(true);
  });

  describe('processClientSelection', () => {
    test('should update the session to viewing_config and return grouped configuration output', async () => {
      configSessionServiceMock.getActiveSession.mockResolvedValue({
        session_id: 'session-1',
        current_stage: 'selecting_client',
        expires_at: new Date(Date.now() + 60_000).toISOString()
      });

      const result = await processClientSelection('+6281234567890', '1');

      expect(result).toEqual(expect.objectContaining({
        success: true,
        clientId: 'CLIENT_001',
        clientName: 'Production Gateway',
        message: 'Configuration display',
        hasCustomConfig: true
      }));
      expect(configSessionServiceMock.setViewingConfiguration).toHaveBeenCalledWith(
        'session-1',
        'CLIENT_001',
        expect.objectContaining({
          connection: expect.any(Object),
          message_handling: expect.any(Object),
          notifications: expect.any(Object),
          automation_rules: expect.any(Object)
        })
      );
    });

    test('should cache configuration overview formatting per client', async () => {
      configSessionServiceMock.getActiveSession
        .mockResolvedValueOnce({
          session_id: 'session-a',
          current_stage: 'selecting_client',
          expires_at: new Date(Date.now() + 60_000).toISOString()
        })
        .mockResolvedValueOnce({
          session_id: 'session-b',
          current_stage: 'selecting_client',
          expires_at: new Date(Date.now() + 60_000).toISOString()
        });

      await processClientSelection('+6281234567890', '1');
      await processClientSelection('+6281234567891', '1');

      expect(clientConfigServiceMocks.getFormattedClientConfiguration).toHaveBeenCalledTimes(1);
      expect(clientConfigServiceMocks.formatConfigurationDisplay).toHaveBeenCalledTimes(1);
      expect(clientConfigServiceMocks.hasClientCustomConfiguration).toHaveBeenCalledTimes(1);
    });
  });

  describe('processYesNoResponse', () => {
    test('should accept localized positive tokens and move to selecting_group', async () => {
      configSessionServiceMock.getActiveSession.mockResolvedValue({
        session_id: 'session-1',
        client_id: 'CLIENT_001',
        current_stage: 'viewing_config',
        expires_at: new Date(Date.now() + 60_000).toISOString()
      });

      const result = await processYesNoResponse('+6281234567890', 'ya');

      expect(result).toEqual({
        success: true,
        nextStage: 'selecting_group',
        message: 'Group selection prompt'
      });
      expect(configSessionServiceMock.updateSessionStage).toHaveBeenCalledWith(
        'session-1',
        'selecting_group'
      );
    });

    test('should end the session when the administrator declines modification', async () => {
      configSessionServiceMock.getActiveSession.mockResolvedValue({
        session_id: 'session-2',
        client_id: 'CLIENT_002',
        current_stage: 'viewing_config',
        expires_at: new Date(Date.now() + 60_000).toISOString()
      });

      const result = await processYesNoResponse('+6281234567890', 'tidak');

      expect(result).toEqual({
        success: true,
        nextStage: 'completed',
        message: '✅ CONFIGURATION REVIEW COMPLETED\n\nNo changes were made to CLIENT_002.\nSession ended.'
      });
      expect(configSessionServiceMock.deleteSession).toHaveBeenCalledWith('session-2');
    });
  });
});
