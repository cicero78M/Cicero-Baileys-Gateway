import { jest } from '@jest/globals';

const clientConfigServiceMocks = {
  getActiveClients: jest.fn(),
  getFormattedClientConfiguration: jest.fn(),
  formatClientListDisplay: jest.fn(),
  formatConfigurationDisplay: jest.fn(),
  formatGroupSelectionDisplay: jest.fn(),
  hasClientCustomConfiguration: jest.fn(),
  formatChangesSummary: jest.fn(),
  applyConfigurationChanges: jest.fn(),
  invalidateClientCache: jest.fn(),
  getMessageTemplates: jest.fn()
};

const configSessionServiceMock = {
  cleanupExpiredSessions: jest.fn(),
  getActiveSession: jest.fn(),
  createSession: jest.fn(),
  deleteSession: jest.fn(),
  completeSession: jest.fn(),
  rollbackSession: jest.fn(),
  setViewingConfiguration: jest.fn(),
  updateSessionStage: jest.fn(),
  extendSession: jest.fn(),
  addPendingChange: jest.fn(),
  isSessionNearExpiry: jest.fn(),
  getSessionsByClient: jest.fn()
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
  processConfigurationModification,
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
          { key: 'connection.host', parameter: 'host', value: 'gateway.example.com', description: 'Valid hostname' },
          { key: 'connection.port', parameter: 'port', value: '8080', description: 'Valid port number' }
        ]
      },
      notifications: {
        displayName: 'Notifications',
        parameters: [
          { key: 'notifications.status_alerts', parameter: 'status_alerts', value: 'true', description: 'Boolean flag' }
        ]
      }
    });
    clientConfigServiceMocks.formatConfigurationDisplay.mockResolvedValue('Configuration display');
    clientConfigServiceMocks.hasClientCustomConfiguration.mockResolvedValue(true);
    clientConfigServiceMocks.formatGroupSelectionDisplay.mockResolvedValue('Group selection prompt');
    clientConfigServiceMocks.formatChangesSummary.mockResolvedValue('Pending changes summary');
    clientConfigServiceMocks.applyConfigurationChanges.mockResolvedValue({
      success: true,
      appliedChanges: {
        'connection.host': 'api.newgateway.com'
      },
      errors: []
    });
    clientConfigServiceMocks.getMessageTemplates.mockResolvedValue({});
    configSessionServiceMock.setViewingConfiguration.mockResolvedValue({
      session_id: 'session-1',
      current_stage: 'viewing_config'
    });
    configSessionServiceMock.updateSessionStage.mockResolvedValue({
      session_id: 'session-1',
      current_stage: 'selecting_group'
    });
    configSessionServiceMock.deleteSession.mockResolvedValue(true);
    configSessionServiceMock.completeSession.mockResolvedValue(true);
    configSessionServiceMock.rollbackSession.mockResolvedValue(true);
    configSessionServiceMock.addPendingChange.mockImplementation(async (sessionId, configKey, oldValue, newValue) => ({
      session_id: sessionId,
      pending_changes: {
        [configKey]: {
          old_value: oldValue,
          new_value: newValue
        }
      }
    }));
    configSessionServiceMock.isSessionNearExpiry.mockResolvedValue(false);
    configSessionServiceMock.getSessionsByClient.mockResolvedValue([]);
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

    test('should apply pending changes when confirmation is approved', async () => {
      configSessionServiceMock.getActiveSession.mockResolvedValue({
        session_id: 'session-confirm',
        client_id: 'CLIENT_001',
        phone_number: '+6281234567890',
        current_stage: 'confirming_changes',
        pending_changes: {
          'connection.host': {
            old_value: 'gateway.example.com',
            new_value: 'api.newgateway.com'
          }
        },
        expires_at: new Date(Date.now() + 60_000).toISOString()
      });

      const result = await processYesNoResponse('+6281234567890', 'yes');

      expect(clientConfigServiceMocks.applyConfigurationChanges).toHaveBeenCalledWith('CLIENT_001', {
        'connection.host': 'api.newgateway.com'
      });
      expect(configSessionServiceMock.completeSession).toHaveBeenCalledWith(
        'session-confirm',
        { 'connection.host': 'api.newgateway.com' }
      );
      expect(result).toEqual(expect.objectContaining({
        success: true,
        nextStage: 'completed',
        message: expect.stringContaining('CONFIGURATION UPDATED SUCCESSFULLY')
      }));
    });

    test('should discard pending changes when confirmation is rejected', async () => {
      configSessionServiceMock.getActiveSession.mockResolvedValue({
        session_id: 'session-discard',
        client_id: 'CLIENT_001',
        phone_number: '+6281234567890',
        current_stage: 'confirming_changes',
        pending_changes: {
          'connection.host': {
            old_value: 'gateway.example.com',
            new_value: 'api.newgateway.com'
          }
        },
        expires_at: new Date(Date.now() + 60_000).toISOString()
      });

      const result = await processYesNoResponse('+6281234567890', 'no');

      expect(configSessionServiceMock.deleteSession).toHaveBeenCalledWith('session-discard');
      expect(result).toEqual({
        success: true,
        nextStage: 'completed',
        message: '🚫 Configuration changes discarded.\n\nCLIENT_001 configuration remains unchanged.\nSession ended.'
      });
    });
  });

  describe('processConfigurationModification', () => {
    test('should select a configuration group and show its parameters', async () => {
      const session = {
        session_id: 'session-group',
        client_id: 'CLIENT_001',
        phone_number: '+6281234567890',
        current_stage: 'selecting_group',
        original_state: {
          connection: {
            displayName: 'Connection Settings',
            parameters: [
              {
                key: 'connection.host',
                parameter: 'host',
                value: 'gateway.example.com',
                description: 'Valid hostname',
                validationPattern: null
              }
            ]
          }
        },
        pending_changes: {},
        expires_at: new Date(Date.now() + 60_000).toISOString()
      };
      configSessionServiceMock.getActiveSession.mockResolvedValue(session);
      configSessionServiceMock.updateSessionStage.mockResolvedValue({
        ...session,
        current_stage: 'modifying_config',
        configuration_group: 'connection'
      });

      const result = await processConfigurationModification('+6281234567890', '1');

      expect(result).toEqual(expect.objectContaining({
        handled: true,
        success: true,
        inputType: 'group_selection',
        nextStage: 'modifying_config',
        message: expect.stringContaining('CONNECTION SETTINGS CONFIGURATION')
      }));
    });

    test('should reject invalid configuration values with guidance', async () => {
      configSessionServiceMock.getActiveSession.mockResolvedValue({
        session_id: 'session-value',
        client_id: 'CLIENT_001',
        phone_number: '+6281234567890',
        current_stage: 'modifying_config',
        configuration_group: 'connection',
        selected_parameter_key: 'connection.host',
        original_state: {
          connection: {
            displayName: 'Connection Settings',
            parameters: [
              {
                key: 'connection.host',
                parameter: 'host',
                value: 'gateway.example.com',
                description: 'Valid hostname',
                validationPattern: null
              }
            ]
          }
        },
        pending_changes: {},
        expires_at: new Date(Date.now() + 60_000).toISOString()
      });

      const result = await processConfigurationModification('+6281234567890', 'invalid host');

      expect(result).toEqual(expect.objectContaining({
        handled: true,
        success: false,
        error: 'INVALID_CONFIG_VALUE',
        message: expect.stringContaining('Please enter a valid value')
      }));
    });

    test('should record a pending change and ask whether to continue', async () => {
      configSessionServiceMock.getActiveSession.mockResolvedValue({
        session_id: 'session-change',
        client_id: 'CLIENT_001',
        phone_number: '+6281234567890',
        current_stage: 'modifying_config',
        configuration_group: 'connection',
        selected_parameter_key: 'connection.host',
        original_state: {
          connection: {
            displayName: 'Connection Settings',
            parameters: [
              {
                key: 'connection.host',
                parameter: 'host',
                value: 'gateway.example.com',
                description: 'Valid hostname',
                validationPattern: null
              }
            ]
          }
        },
        pending_changes: {},
        expires_at: new Date(Date.now() + 60_000).toISOString()
      });

      const result = await processConfigurationModification('+6281234567890', 'api.newgateway.com');

      expect(configSessionServiceMock.addPendingChange).toHaveBeenCalledWith(
        'session-change',
        'connection.host',
        'gateway.example.com',
        'api.newgateway.com'
      );
      expect(result).toEqual(expect.objectContaining({
        handled: true,
        success: true,
        inputType: 'parameter_value',
        message: expect.stringContaining('Reply "yes" to continue modifying this client')
      }));
    });

    test('should move to confirmation when the administrator finishes editing', async () => {
      configSessionServiceMock.getActiveSession
        .mockResolvedValueOnce({
          session_id: 'session-finish',
          client_id: 'CLIENT_001',
          phone_number: '+6281234567890',
          current_stage: 'modifying_config',
          configuration_group: 'connection',
          original_state: {
            connection: {
              displayName: 'Connection Settings',
              parameters: [
                {
                  key: 'connection.host',
                  parameter: 'host',
                  value: 'gateway.example.com',
                  description: 'Valid hostname',
                  validationPattern: null
                }
              ]
            }
          },
          pending_changes: {
            'connection.host': {
              old_value: 'gateway.example.com',
              new_value: 'api.newgateway.com'
            }
          },
          expires_at: new Date(Date.now() + 60_000).toISOString()
        })
        .mockResolvedValueOnce({
          session_id: 'session-finish',
          client_id: 'CLIENT_001',
          phone_number: '+6281234567890',
          current_stage: 'confirming_changes',
          pending_changes: {
            'connection.host': {
              old_value: 'gateway.example.com',
              new_value: 'api.newgateway.com'
            }
          },
          expires_at: new Date(Date.now() + 60_000).toISOString()
        });

      const result = await processConfigurationModification('+6281234567890', 'done');

      expect(clientConfigServiceMocks.formatChangesSummary).toHaveBeenCalledWith(
        'CLIENT_001',
        {
          'connection.host': {
            old_value: 'gateway.example.com',
            new_value: 'api.newgateway.com'
          }
        }
      );
      expect(result).toEqual(expect.objectContaining({
        handled: true,
        success: true,
        nextStage: 'confirming_changes',
        message: 'Pending changes summary'
      }));
    });
  });
});
