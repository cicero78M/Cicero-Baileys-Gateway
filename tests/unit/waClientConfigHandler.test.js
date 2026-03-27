import { jest } from '@jest/globals';

const serviceMocks = {
  initiateConfigurationSession: jest.fn(),
  processClientSelection: jest.fn(),
  processConfigurationModification: jest.fn(),
  processYesNoResponse: jest.fn(),
  handleSessionExtension: jest.fn()
};

const configSessionServiceMock = {
  getActiveSession: jest.fn()
};

await jest.unstable_mockModule('../../src/service/waClientConfigService.js', () => ({
  ...serviceMocks
}));

await jest.unstable_mockModule('../../src/service/configSessionService.js', () => ({
  ConfigSessionService: configSessionServiceMock
}));

const { waClientConfigHandler } = await import('../../src/handler/waClientConfigHandler.js');

describe('waClientConfigHandler', () => {
  let mockContext;

  beforeEach(() => {
    jest.clearAllMocks();
    configSessionServiceMock.getActiveSession.mockResolvedValue(null);
    serviceMocks.processConfigurationModification.mockResolvedValue(null);

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
  });

  describe('Command Recognition', () => {
    const validCommands = ['/config', 'CONFIG', 'configure', 'config', 'CONFIGURE'];
    const invalidCommands = ['configuration', '/configure-client', 'help', 'status', ''];

    test.each(validCommands)('should recognize valid command: %s', async (command) => {
      mockContext.message.extendedTextMessage.text = command;
      serviceMocks.initiateConfigurationSession.mockResolvedValue({
        success: true,
        sessionId: 'test-session-123',
        message: 'Client list'
      });

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(true);
      expect(serviceMocks.initiateConfigurationSession).toHaveBeenCalledWith('+6281234567890');
      expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
        mockContext.remoteJid,
        { text: 'Client list', quoted: mockContext.message }
      );
    });

    test.each(invalidCommands)('should ignore invalid command without an active session: %s', async (command) => {
      mockContext.message.extendedTextMessage.text = command;

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(false);
      expect(serviceMocks.initiateConfigurationSession).not.toHaveBeenCalled();
      expect(mockContext.sock.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Security Validation', () => {
    test('should reject group messages', async () => {
      mockContext.remoteJid = '123456789-1234567890@g.us';
      mockContext.isGroup = true;

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(false);
    });

    test('should reject newsletter messages', async () => {
      mockContext.remoteJid = '123456789@newsletter';

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(false);
    });
  });

  describe('Session Routing', () => {
    test('should process client selection only during selecting_client stage', async () => {
      mockContext.message.extendedTextMessage.text = '1';
      configSessionServiceMock.getActiveSession.mockResolvedValue({
        session_id: 'session-1',
        current_stage: 'selecting_client'
      });
      serviceMocks.processClientSelection.mockResolvedValue({
        success: true,
        clientId: 'CLIENT_001',
        message: 'Configuration overview'
      });

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(true);
      expect(serviceMocks.processClientSelection).toHaveBeenCalledWith('+6281234567890', '1');
    });

    test('should not hijack numeric input when no active configuration session exists', async () => {
      mockContext.message.extendedTextMessage.text = '1';

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(false);
      expect(serviceMocks.processClientSelection).not.toHaveBeenCalled();
    });

    test('should recognize yes/no tokens during viewing_config stage', async () => {
      mockContext.message.extendedTextMessage.text = 'ya';
      configSessionServiceMock.getActiveSession.mockResolvedValue({
        session_id: 'session-2',
        current_stage: 'viewing_config'
      });
      serviceMocks.processYesNoResponse.mockResolvedValue({
        success: true,
        nextStage: 'selecting_group',
        message: 'Group selection'
      });

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(true);
      expect(serviceMocks.processYesNoResponse).toHaveBeenCalledWith('+6281234567890', 'ya');
    });

    test('should route extension requests when a session is active', async () => {
      mockContext.message.extendedTextMessage.text = 'extend';
      configSessionServiceMock.getActiveSession.mockResolvedValue({
        session_id: 'session-3',
        current_stage: 'viewing_config'
      });
      serviceMocks.handleSessionExtension.mockResolvedValue({
        success: true,
        message: 'Session extended'
      });

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(true);
      expect(serviceMocks.handleSessionExtension).toHaveBeenCalledWith('+6281234567890');
      expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
        mockContext.remoteJid,
        { text: 'Session extended', quoted: mockContext.message }
      );
    });
  });

  describe('Message Format Extraction', () => {
    test('should extract text from conversation payloads', async () => {
      mockContext.message = { conversation: '/config' };
      serviceMocks.initiateConfigurationSession.mockResolvedValue({
        success: true,
        sessionId: 'session-conversation',
        message: 'Conversation response'
      });

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(true);
      expect(serviceMocks.initiateConfigurationSession).toHaveBeenCalledWith('+6281234567890');
    });

    test('should ignore messages without text', async () => {
      mockContext.message = {};

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(false);
    });
  });
});
