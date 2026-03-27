/**
 * waClientConfigHandler.test.js
 * Unit tests for WhatsApp client configuration handler
 * Tests command recognition, message processing, and response formatting
 */

import { jest } from '@jest/globals';
import { waClientConfigHandler } from '../../src/handler/waClientConfigHandler.js';
import * as waClientConfigService from '../../src/service/waClientConfigService.js';

// Mock dependencies
jest.mock('../../src/service/waClientConfigService.js');

describe('waClientConfigHandler', () => {
  let mockContext;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Standard mock context for WhatsApp message
    mockContext = {
      sock: {
        sendMessage: jest.fn().mockResolvedValue({ status: 'success' })
      },
      remoteJid: '+6281234567890@s.whatsapp.net', // Administrator's own number
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
      
      // Mock service response for client list
      waClientConfigService.initiateConfigurationSession.mockResolvedValue({
        success: true,
        sessionId: 'test-session-123',
        message: '🔧 CLIENT CONFIGURATION MANAGEMENT\n\nAvailable active clients:\n1. CLIENT_001\n\nReply with number to select.'
      });

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(true);
      expect(waClientConfigService.initiateConfigurationSession).toHaveBeenCalledWith('+6281234567890');
      expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
        mockContext.remoteJid,
        { text: expect.stringContaining('🔧 CLIENT CONFIGURATION MANAGEMENT') },
        { quoted: mockContext.message }
      );
    });

    test.each(invalidCommands)('should not recognize invalid command: %s', async (command) => {
      mockContext.message.extendedTextMessage.text = command;
      
      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(false);
      expect(waClientConfigService.initiateConfigurationSession).not.toHaveBeenCalled();
      expect(mockContext.sock.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Security Validation', () => {
    beforeEach(() => {
      mockContext.message.extendedTextMessage.text = '/config';
    });

    test('should allow direct-message configuration requests', async () => {
      waClientConfigService.initiateConfigurationSession.mockResolvedValue({
        success: true,
        sessionId: 'test-session',
        message: 'Client list message'
      });

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(true);
    });

    test('should reject group messages', async () => {
      mockContext.remoteJid = '123456789-1234567890@g.us'; // Group JID
      mockContext.isGroup = true;

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(false);
    });

    test('should reject newsletter messages', async () => {
      mockContext.remoteJid = '123456789@newsletter'; // Newsletter JID

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(false);
    });
  });

  describe('Session Workflow', () => {
    beforeEach(() => {
      mockContext.message.extendedTextMessage.text = '/config';
    });

    test('should handle successful session initiation', async () => {
      waClientConfigService.initiateConfigurationSession.mockResolvedValue({
        success: true,
        sessionId: 'session-abc-123',
        message: '🔧 CLIENT CONFIGURATION MANAGEMENT\n\nAvailable active clients:\n1. CLIENT_001 (Gateway)\n\nReply with number (1) to select.'
      });

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(true);
      expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
        mockContext.remoteJid,
        { text: expect.stringContaining('🔧 CLIENT CONFIGURATION MANAGEMENT') },
        { quoted: mockContext.message }
      );
    });

    test('should handle no active clients scenario', async () => {
      waClientConfigService.initiateConfigurationSession.mockResolvedValue({
        success: false,
        error: 'NO_ACTIVE_CLIENTS',
        message: '⚠️ CLIENT CONFIGURATION MANAGEMENT\n\nNo active clients available for configuration at this time.'
      });

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(true);
      expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
        mockContext.remoteJid,
        { text: expect.stringContaining('⚠️ CLIENT CONFIGURATION MANAGEMENT') },
        { quoted: mockContext.message }
      );
    });

    test('should handle system errors gracefully', async () => {
      waClientConfigService.initiateConfigurationSession.mockRejectedValue(
        new Error('Database connection failed')
      );

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(true);
      expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
        mockContext.remoteJid,
        { text: expect.stringContaining('System temporarily unavailable') },
        { quoted: mockContext.message }
      );
    });
  });

  describe('Client Selection Processing', () => {
    test('should process valid client selection', async () => {
      mockContext.message.extendedTextMessage.text = '1';
      
      waClientConfigService.processClientSelection.mockResolvedValue({
        success: true,
        clientId: 'CLIENT_001',
        message: '📋 CURRENT CONFIGURATION - CLIENT_001\n\n🔗 CONNECTION SETTINGS:\n• Host: gateway.example.com'
      });

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(true);
      expect(waClientConfigService.processClientSelection).toHaveBeenCalledWith(
        '+6281234567890',
        '1'
      );
    });

    test('should handle invalid client selection', async () => {
      mockContext.message.extendedTextMessage.text = '99';
      
      waClientConfigService.processClientSelection.mockResolvedValue({
        success: false,
        error: 'INVALID_SELECTION',
        message: 'Invalid selection. Please reply with a number from the list.'
      });

      const result = await waClientConfigHandler(mockContext);

      expect(result).toBe(true);
      expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
        mockContext.remoteJid,
        { text: expect.stringContaining('Invalid selection') },
        { quoted: mockContext.message }
      );
    });
  });

  describe('Message Format Extraction', () => {
    test('should extract text from extendedTextMessage', async () => {
      mockContext.message = {
        extendedTextMessage: { text: '/config' }
      };
      delete mockContext.message.conversation;

      waClientConfigService.initiateConfigurationSession.mockResolvedValue({
        success: true,
        sessionId: 'test',
        message: 'Test response'
      });

      const result = await waClientConfigHandler(mockContext);
      expect(result).toBe(true);
    });

    test('should extract text from conversation', async () => {
      mockContext.message = {
        conversation: '/config'
      };
      delete mockContext.message.extendedTextMessage;

      waClientConfigService.initiateConfigurationSession.mockResolvedValue({
        success: true,
        sessionId: 'test',
        message: 'Test response'
      });

      const result = await waClientConfigHandler(mockContext);
      expect(result).toBe(true);
    });

    test('should handle missing message text', async () => {
      mockContext.message = {};

      const result = await waClientConfigHandler(mockContext);
      expect(result).toBe(false);
    });
  });
});
