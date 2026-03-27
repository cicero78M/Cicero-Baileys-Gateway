/**
 * waClientConfig.integration.test.js
 * Integration tests for WhatsApp client configuration workflow
 * Tests complete end-to-end flow from command recognition to configuration display
 */

import { jest } from '@jest/globals';
import { query as dbQuery } from '../../src/db/postgres.js';
import { waClientConfigHandler } from '../../src/handler/waClientConfigHandler.js';

// Mock external dependencies but test real service interactions
jest.mock('../../src/db/postgres.js');

describe('WhatsApp Client Configuration Integration', () => {
  let testAdminPhone;
  let testClientId;
  let mockContext;

  beforeAll(async () => {
    testAdminPhone = '+6281234567890';
    testClientId = 'CLIENT_001';
  });

  beforeEach(async () => {
    // Clear all mocks
    jest.clearAllMocks();

    // Setup mock context
    mockContext = {
      sock: {
        sendMessage: jest.fn().mockResolvedValue({ status: 'success' })
      },
      remoteJid: `${testAdminPhone}@s.whatsapp.net`,
      message: {
        extendedTextMessage: {
          text: '/config'
        }
      },
      isGroup: false,
      quotedInfo: null
    };

    // Mock database queries for test data setup
    await setupTestData();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  async function setupTestData() {
    // Mock administrator authorization check
    dbQuery.mockImplementation((sql, params) => {
      // Administrator authorization query
      if (sql.includes('administrator_authorization') && params[0] === testAdminPhone) {
        return Promise.resolve({
          rows: [{
            phone_number: testAdminPhone,
            is_authorized: true,
            permission_level: 'full',
            client_access_scope: null
          }]
        });
      }
      
      // Active clients query
      if (sql.includes('SELECT client_id, client_name, status') && sql.includes("status = 'active'")) {
        return Promise.resolve({
          rows: [
            {
              client_id: 'CLIENT_001',
              client_name: 'Production Gateway',
              status: 'active',
              created_at: new Date('2026-01-01')
            },
            {
              client_id: 'CLIENT_002', 
              client_name: 'Development Gateway',
              status: 'active',
              created_at: new Date('2026-01-02')
            }
          ]
        });
      }
      
      // Session creation query
      if (sql.includes('INSERT INTO client_config_sessions')) {
        return Promise.resolve({
          rows: [{
            session_id: 'test-session-123',
            phone_number: testAdminPhone,
            client_id: null,
            current_stage: 'selecting_client',
            expires_at: new Date(Date.now() + 600000), // 10 minutes
            created_at: new Date()
          }]
        });
      }
      
      // Session update query 
      if (sql.includes('UPDATE client_config_sessions')) {
        return Promise.resolve({
          rows: [{
            session_id: 'test-session-123',
            phone_number: testAdminPhone,
            client_id: testClientId,
            current_stage: 'viewing_config',
            expires_at: new Date(Date.now() + 600000),
            updated_at: new Date()
          }]
        });
      }
      
      // Client configuration query
      if (sql.includes('SELECT cc.config_key, cc.config_value')) {
        return Promise.resolve({
          rows: [
            {
              config_key: 'connection.host',
              config_value: 'gateway.example.com',
              config_group: 'connection',
              description: 'Server hostname or IP address',
              validation_pattern: '^[a-zA-Z0-9.-]+$'
            },
            {
              config_key: 'connection.port',
              config_value: '8080',
              config_group: 'connection',
              description: 'Server port number',
              validation_pattern: '^[1-9][0-9]{0,4}$'
            },
            {
              config_key: 'message_handling.rate_limit',
              config_value: '40/minute',
              config_group: 'message_handling',
              description: 'Maximum message rate',
              validation_pattern: '^\\d+/(second|minute|hour)$'
            }
          ]
        });
      }
      
      // Template messages query
      if (sql.includes('SELECT template_key, template_text')) {
        return Promise.resolve({ rows: [] });
      }
      
      // Default fallback
      return Promise.resolve({ rows: [] });
    });
  }

  async function cleanupTestData() {
    // Mock cleanup - in real integration test this would clean up test data
    dbQuery.mockReset();
  }

  describe('Complete Client Selection Workflow', () => {
    test('should handle full workflow from command to client configuration display', async () => {
      // Step 1: Initial command recognition and client list display
      const step1Result = await waClientConfigHandler(mockContext);
      
      expect(step1Result).toBe(true);
      expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
        mockContext.remoteJid,
        {
          text: expect.stringMatching(
            /🔧 CLIENT CONFIGURATION MANAGEMENT[\s\S]*Available active clients:[\s\S]*1\. CLIENT_001[\s\S]*2\. CLIENT_002/
          )
        },
        { quoted: mockContext.message }
      );
      
      // Verify session was created
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO client_config_sessions'),
        expect.arrayContaining([testAdminPhone, 'selecting_client'])
      );
      
      jest.clearAllMocks();
      
      // Step 2: Client selection
      mockContext.message.extendedTextMessage.text = '1';
      
      const step2Result = await waClientConfigHandler(mockContext);
      
      expect(step2Result).toBe(true);
      expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
        mockContext.remoteJid,
        {
          text: expect.stringMatching(
            /📋 CURRENT CONFIGURATION - CLIENT_001[\s\S]*🔗 CONNECTION SETTINGS:[\s\S]*• Host: gateway\.example\.com[\s\S]*• Port: 8080/
          )
        },
        { quoted: mockContext.message }
      );
      
      // Verify session was updated
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE client_config_sessions'),
        expect.arrayContaining(['CLIENT_001', 'viewing_config'])
      );
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle database connection failures gracefully', async () => {
      // Simulate database connection failure
      dbQuery.mockRejectedValue(new Error('Connection pool exhausted'));
      
      const result = await waClientConfigHandler(mockContext);
      
      expect(result).toBe(true);
      expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
        mockContext.remoteJid,
        {
          text: expect.stringContaining('System temporarily unavailable')
        },
        { quoted: mockContext.message }
      );
    });

    test('should handle no active clients scenario', async () => {
      // Mock empty active clients result
      dbQuery.mockImplementation((sql) => {
        if (sql.includes('administrator_authorization')) {
          return Promise.resolve({
            rows: [{
              phone_number: testAdminPhone,
              is_authorized: true,
              permission_level: 'full'
            }]
          });
        }
        if (sql.includes("status = 'active'")) {
          return Promise.resolve({ rows: [] }); // No active clients
        }
        return Promise.resolve({ rows: [] });
      });
      
      const result = await waClientConfigHandler(mockContext);
      
      expect(result).toBe(true);
      expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
        mockContext.remoteJid,
        {
          text: expect.stringContaining('⚠️ CLIENT CONFIGURATION MANAGEMENT') &&
               expect.stringContaining('No active clients available')
        },
        { quoted: mockContext.message }
      );
    });

    test('should handle client becoming inactive during selection', async () => {
      // Mock client becoming inactive between session creation and selection
      let callCount = 0;
      dbQuery.mockImplementation((sql, params) => {
        callCount++;
        
        if (sql.includes('administrator_authorization')) {
          return Promise.resolve({
            rows: [{ phone_number: testAdminPhone, is_authorized: true, permission_level: 'full' }]
          });
        }
        
        if (sql.includes("status = 'active'")) {
          // First call returns active clients, second call returns empty (client became inactive)
          if (callCount <= 2) {
            return Promise.resolve({
              rows: [{
                client_id: 'CLIENT_001',
                client_name: 'Production Gateway',
                status: 'active'
              }]
            });
          } else {
            return Promise.resolve({ rows: [] }); // Client became inactive
          }
        }
        
        return Promise.resolve({ rows: [] });
      });
      
      // Initial session creation
      await waClientConfigHandler(mockContext);
      
      jest.clearAllMocks();
      
      // Try to select the client after it became inactive
      mockContext.message.extendedTextMessage.text = '1';
      
      const result = await waClientConfigHandler(mockContext);
      
      expect(result).toBe(true);
      expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
        mockContext.remoteJid,
        {
          text: expect.stringContaining('⚠️ CLIENT UNAVAILABLE')
        },
        { quoted: mockContext.message }
      );
    });
  });

  describe('Session State Management Integration', () => {
    test('should handle session timeout warnings', async () => {
      // Mock near-expiry session
      dbQuery.mockImplementation((sql, params) => {
        if (sql.includes('administrator_authorization')) {
          return Promise.resolve({
            rows: [{ phone_number: testAdminPhone, is_authorized: true, permission_level: 'full' }]
          });
        }
        
        if (sql.includes('client_config_sessions') && sql.includes('SELECT')) {
          return Promise.resolve({
            rows: [{
              session_id: 'test-session-123',
              phone_number: testAdminPhone,
              current_stage: 'selecting_client',
              expires_at: new Date(Date.now() + 60000), // Expires in 1 minute
              timeout_extensions: 0
            }]
          });
        }
        
        return Promise.resolve({ rows: [] });
      });
      
      mockContext.message.extendedTextMessage.text = 'extend';
      
      const result = await waClientConfigHandler(mockContext);
      
      expect(result).toBe(true);
      // Should handle session extension logic
    });
    
    test('should prevent concurrent session creation', async () => {
      // Mock existing active session for the same phone number
      dbQuery.mockImplementation((sql, params) => {
        if (sql.includes('administrator_authorization')) {
          return Promise.resolve({
            rows: [{ phone_number: testAdminPhone, is_authorized: true, permission_level: 'full' }]
          });
        }
        
        if (sql.includes('client_config_sessions') && sql.includes('SELECT')) {
          return Promise.resolve({
            rows: [{
              session_id: 'existing-session-456',
              phone_number: testAdminPhone,
              current_stage: 'viewing_config',
              expires_at: new Date(Date.now() + 300000) // 5 minutes left
            }]
          });
        }
        
        return Promise.resolve({ rows: [] });
      });
      
      const result = await waClientConfigHandler(mockContext);
      
      expect(result).toBe(true);
      expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
        mockContext.remoteJid,
        {
          text: expect.stringContaining('existing configuration session')
        },
        { quoted: mockContext.message }
      );
    });
  });

  describe('Client Visibility Integration', () => {
    test('should list all active clients without access-scope filtering', async () => {
      dbQuery.mockImplementation((sql, params) => {
        if (sql.includes('administrator_authorization') && params[0] === testAdminPhone) {
          return Promise.resolve({
            rows: [{
              phone_number: testAdminPhone,
              is_authorized: true,
              permission_level: 'specific_clients',
              client_access_scope: ['CLIENT_001'] // Can only access CLIENT_001
            }]
          });
        }
        
        if (sql.includes("status = 'active'")) {
          return Promise.resolve({
            rows: [
              {
                client_id: 'CLIENT_001',
                client_name: 'Production Gateway',
                status: 'active'
              },
              {
                client_id: 'CLIENT_002',
                client_name: 'Development Gateway',
                status: 'active'
              }
            ]
          });
        }
        
        return Promise.resolve({ rows: [] });
      });
      
      const result = await waClientConfigHandler(mockContext);
      
      expect(result).toBe(true);
      expect(mockContext.sock.sendMessage).toHaveBeenCalledWith(
        mockContext.remoteJid,
        {
          text: expect.stringMatching(
            /Available active clients:[\s\S]*1\. CLIENT_001[\s\S]*2\. CLIENT_002/
          )
        },
        { quoted: mockContext.message }
      );
    });
  });

  describe('Message Format Validation Integration', () => {
    test('should handle various WhatsApp message formats', async () => {
      const messageFormats = [
        { extendedTextMessage: { text: '/config' } },
        { conversation: 'CONFIG' },
        { extendedTextMessage: { text: 'configure' } }
      ];
      
      for (const messageFormat of messageFormats) {
        mockContext.message = messageFormat;
        
        const result = await waClientConfigHandler(mockContext);
        expect(result).toBe(true);
        
        jest.clearAllMocks();
      }
    });
  });
});
