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

await jest.unstable_mockModule('../../src/db/index.js', () => ({
  query: dbIndexMock.query
}));

await jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: loggerMock
}));

const { waClientConfigHandler } = await import('../../src/handler/waClientConfigHandler.js');
const { ConfigSessionService } = await import('../../src/service/configSessionService.js');
const { clearConfigurationOverviewCache } = await import('../../src/service/waClientConfigService.js');

describe('WhatsApp Client Configuration Integration', () => {
  let mockContext;

  beforeEach(async () => {
    jest.clearAllMocks();
    await ConfigSessionService.resetAllSessions();
    clearConfigurationOverviewCache();

    mockContext = {
      sock: {
        sendMessage: jest.fn().mockResolvedValue({ status: 'success' })
      },
      remoteJid: '+6281234567890@s.whatsapp.net',
      message: {
        extendedTextMessage: {
          text: '/config'
        }
      },
      isGroup: false,
      quotedInfo: null
    };

    clientConfigServiceMocks.getActiveClients.mockResolvedValue([
      { client_id: 'CLIENT_001', client_name: 'Production Gateway' },
      { client_id: 'CLIENT_002', client_name: 'Development Gateway' }
    ]);
    clientConfigServiceMocks.formatClientListDisplay.mockResolvedValue(
      '🔧 CLIENT CONFIGURATION MANAGEMENT\n\nAvailable active clients:\n1. CLIENT_001 (Production Gateway)\n2. CLIENT_002 (Development Gateway)\n\nReply with the number (1-2) to select a client for configuration.\n\nSession expires in 10 minutes.'
    );
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
    clientConfigServiceMocks.formatConfigurationDisplay.mockResolvedValue(
      '📋 CURRENT CONFIGURATION - CLIENT_001\n\n🔗 CONNECTION SETTINGS:\n• Host: gateway.example.com\n• Port: 8080\n\n🔔 NOTIFICATIONS:\n• Status Alerts: Yes\n\nWould you like to modify any configuration settings? (yes/no)'
    );
    clientConfigServiceMocks.formatGroupSelectionDisplay.mockResolvedValue(
      '🛠️ CONFIGURATION MODIFICATION\n\nWhich configuration group would you like to modify?\n\n1. CONNECTION SETTINGS\n2. MESSAGE HANDLING\n3. NOTIFICATIONS\n4. AUTOMATION RULES'
    );
    clientConfigServiceMocks.hasClientCustomConfiguration.mockResolvedValue(true);
    clientConfigServiceMocks.formatChangesSummary.mockResolvedValue(
      '📝 CONFIGURATION CHANGES SUMMARY\n\nCLIENT_001 - Pending Changes:\n• Host: gateway.example.com → api.newgateway.com'
    );
    clientConfigServiceMocks.applyConfigurationChanges.mockResolvedValue({
      success: true,
      appliedChanges: {
        'connection.host': 'api.newgateway.com'
      },
      errors: []
    });
    clientConfigServiceMocks.getMessageTemplates.mockResolvedValue({});
  });

  test('should complete the selection-to-configuration-display flow', async () => {
    const started = await waClientConfigHandler(mockContext);

    expect(started).toBe(true);
    expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
      mockContext.remoteJid,
      expect.objectContaining({
        text: expect.stringContaining('Available active clients:'),
        quoted: mockContext.message
      })
    );

    mockContext.message.extendedTextMessage.text = '1';
    mockContext.sock.sendMessage.mockClear();

    const selected = await waClientConfigHandler(mockContext);

    expect(selected).toBe(true);
    expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
      mockContext.remoteJid,
      expect.objectContaining({
        text: expect.stringContaining('CURRENT CONFIGURATION - CLIENT_001'),
        quoted: mockContext.message
      })
    );

    const activeSession = await ConfigSessionService.getActiveSession('+6281234567890');
    expect(activeSession).toEqual(expect.objectContaining({
      client_id: 'CLIENT_001',
      current_stage: 'viewing_config'
    }));
  });

  test('should continue from viewing_config to group selection on a positive response', async () => {
    await waClientConfigHandler(mockContext);

    mockContext.message.extendedTextMessage.text = '1';
    await waClientConfigHandler(mockContext);

    mockContext.message.extendedTextMessage.text = 'ya';
    mockContext.sock.sendMessage.mockClear();

    const responded = await waClientConfigHandler(mockContext);

    expect(responded).toBe(true);
    expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
      mockContext.remoteJid,
      expect.objectContaining({
        text: expect.stringContaining('CONFIGURATION MODIFICATION'),
        quoted: mockContext.message
      })
    );

    const activeSession = await ConfigSessionService.getActiveSession('+6281234567890');
    expect(activeSession.current_stage).toBe('selecting_group');
  });

  test('should complete the modification workflow from group selection to confirmation', async () => {
    await waClientConfigHandler(mockContext);

    mockContext.message.extendedTextMessage.text = '1';
    await waClientConfigHandler(mockContext);

    mockContext.message.extendedTextMessage.text = 'yes';
    await waClientConfigHandler(mockContext);

    mockContext.message.extendedTextMessage.text = '1';
    mockContext.sock.sendMessage.mockClear();
    await waClientConfigHandler(mockContext);

    expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
      mockContext.remoteJid,
      expect.objectContaining({
        text: expect.stringContaining('CONNECTION SETTINGS CONFIGURATION'),
        quoted: mockContext.message
      })
    );

    mockContext.message.extendedTextMessage.text = '1';
    mockContext.sock.sendMessage.mockClear();
    await waClientConfigHandler(mockContext);

    expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
      mockContext.remoteJid,
      expect.objectContaining({
        text: expect.stringContaining('MODIFY HOST'),
        quoted: mockContext.message
      })
    );

    mockContext.message.extendedTextMessage.text = 'api.newgateway.com';
    mockContext.sock.sendMessage.mockClear();
    await waClientConfigHandler(mockContext);

    expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
      mockContext.remoteJid,
      expect.objectContaining({
        text: expect.stringContaining('Host updated to'),
        quoted: mockContext.message
      })
    );

    mockContext.message.extendedTextMessage.text = 'no';
    mockContext.sock.sendMessage.mockClear();
    await waClientConfigHandler(mockContext);

    expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
      mockContext.remoteJid,
      expect.objectContaining({
        text: expect.stringContaining('CONFIGURATION CHANGES SUMMARY'),
        quoted: mockContext.message
      })
    );

    mockContext.message.extendedTextMessage.text = 'yes';
    mockContext.sock.sendMessage.mockClear();
    const completed = await waClientConfigHandler(mockContext);

    expect(completed).toBe(true);
    expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
      mockContext.remoteJid,
      expect.objectContaining({
        text: expect.stringContaining('CONFIGURATION UPDATED SUCCESSFULLY'),
        quoted: mockContext.message
      })
    );

    const activeSession = await ConfigSessionService.getActiveSession('+6281234567890');
    expect(activeSession).toBeNull();
  });
});
