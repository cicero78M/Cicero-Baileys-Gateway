/**
 * administratorAuthorizationRepository.test.js
 * Unit tests for administrator authorization repository
 * Tests phone number validation, permission checks, and access control
 */

import { jest } from '@jest/globals';
import * as postgres from '../../src/db/postgres.js';
import {
  isAuthorizedAdministrator,
  getAdministratorPermissions,
  addAuthorizedAdministrator,
  removeAuthorizedAdministrator,
  updateAdministratorPermissions,
  getClientAccessScope
} from '../../src/repository/administratorAuthorizationRepository.js';

// Mock the PostgreSQL connection
jest.mock('../../src/db/postgres.js');

describe('administratorAuthorizationRepository', () => {
  const mockPool = {
    query: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    postgres.query.mockImplementation(mockPool.query);
  });

  describe('isAuthorizedAdministrator', () => {
    test('should return true for authorized administrator', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          phone_number: '+6281234567890',
          is_authorized: true,
          permission_level: 'full'
        }]
      });

      const result = await isAuthorizedAdministrator('+6281234567890');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT phone_number, is_authorized, permission_level FROM administrator_authorization WHERE phone_number = $1 AND is_authorized = true',
        ['+6281234567890']
      );
    });

    test('should return false for unauthorized administrator', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await isAuthorizedAdministrator('+6281234567890');

      expect(result).toBe(false);
    });

    test('should return false for disabled administrator', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          phone_number: '+6281234567890',
          is_authorized: false,
          permission_level: 'full'
        }]
      });

      const result = await isAuthorizedAdministrator('+6281234567890');

      expect(result).toBe(false);
    });

    test('should handle database errors gracefully', async () => {
      mockPool.query.mockRejectedValue(new Error('Database connection failed'));

      await expect(isAuthorizedAdministrator('+6281234567890')).rejects.toThrow('Database connection failed');
    });
  });

  describe('getAdministratorPermissions', () => {
    test('should return full permissions for full access administrator', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          phone_number: '+6281234567890',
          is_authorized: true,
          permission_level: 'full',
          client_access_scope: null,
          created_at: new Date(),
          updated_at: new Date()
        }]
      });

      const result = await getAdministratorPermissions('+6281234567890');

      expect(result).toEqual({
        phone_number: '+6281234567890',
        is_authorized: true,
        permission_level: 'full',
        client_access_scope: null,
        created_at: expect.any(Date),
        updated_at: expect.any(Date)
      });
    });

    test('should return specific client permissions', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          phone_number: '+6281234567890',
          is_authorized: true,
          permission_level: 'specific_clients',
          client_access_scope: ['CLIENT_001', 'CLIENT_002'],
          created_at: new Date(),
          updated_at: new Date()
        }]
      });

      const result = await getAdministratorPermissions('+6281234567890');

      expect(result.permission_level).toBe('specific_clients');
      expect(result.client_access_scope).toEqual(['CLIENT_001', 'CLIENT_002']);
    });

    test('should return null for non-existent administrator', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await getAdministratorPermissions('+6281234567890');

      expect(result).toBeNull();
    });
  });

  describe('addAuthorizedAdministrator', () => {
    test('should add new administrator with full permissions', async () => {
      const insertResult = {
        rows: [{
          phone_number: '+6281234567890',
          is_authorized: true,
          permission_level: 'full',
          client_access_scope: null,
          created_at: new Date(),
          updated_at: new Date()
        }]
      };
      
      mockPool.query.mockResolvedValue(insertResult);

      const result = await addAuthorizedAdministrator(
        '+6281234567890',
        'full'
      );

      expect(result).toEqual(insertResult.rows[0]);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO administrator_authorization'),
        ['+6281234567890', true, 'full', null]
      );
    });

    test('should add administrator with specific client access', async () => {
      const clientScope = ['CLIENT_001', 'CLIENT_002'];
      const insertResult = {
        rows: [{
          phone_number: '+6281234567890',
          is_authorized: true,
          permission_level: 'specific_clients',
          client_access_scope: clientScope,
          created_at: new Date(),
          updated_at: new Date()
        }]
      };
      
      mockPool.query.mockResolvedValue(insertResult);

      const result = await addAuthorizedAdministrator(
        '+6281234567890',
        'specific_clients',
        clientScope
      );

      expect(result.client_access_scope).toEqual(clientScope);
    });

    test('should handle duplicate phone number gracefully', async () => {
      mockPool.query.mockRejectedValue({
        code: '23505', // PostgreSQL unique violation
        constraint: 'administrator_authorization_pkey'
      });

      await expect(
        addAuthorizedAdministrator('+6281234567890', 'full')
      ).rejects.toThrow();
    });
  });

  describe('updateAdministratorPermissions', () => {
    test('should update permission level and client scope', async () => {
      const updateResult = {
        rows: [{
          phone_number: '+6281234567890',
          is_authorized: true,
          permission_level: 'readonly',
          client_access_scope: null,
          updated_at: new Date()
        }]
      };
      
      mockPool.query.mockResolvedValue(updateResult);

      const result = await updateAdministratorPermissions(
        '+6281234567890',
        { permission_level: 'readonly', client_access_scope: null }
      );

      expect(result).toEqual(updateResult.rows[0]);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE administrator_authorization SET'),
        expect.arrayContaining(['+6281234567890'])
      );
    });

    test('should return null if administrator not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await updateAdministratorPermissions(
        '+6281234567890',
        { permission_level: 'readonly' }
      );

      expect(result).toBeNull();
    });
  });

  describe('removeAuthorizedAdministrator', () => {
    test('should remove administrator authorization', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 1 });

      const result = await removeAuthorizedAdministrator('+6281234567890');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        'DELETE FROM administrator_authorization WHERE phone_number = $1',
        ['+6281234567890']
      );
    });

    test('should return false if administrator not found', async () => {
      mockPool.query.mockResolvedValue({ rowCount: 0 });

      const result = await removeAuthorizedAdministrator('+6281234567890');

      expect(result).toBe(false);
    });
  });

  describe('getClientAccessScope', () => {
    test('should return all clients for full permission administrator', async () => {
      // Mock permissions query
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          permission_level: 'full',
          client_access_scope: null
        }]
      });
      
      // Mock all active clients query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { client_id: 'CLIENT_001' },
          { client_id: 'CLIENT_002' },
          { client_id: 'CLIENT_003' }
        ]
      });

      const result = await getClientAccessScope('+6281234567890');

      expect(result).toEqual(['CLIENT_001', 'CLIENT_002', 'CLIENT_003']);
    });

    test('should return specific clients for limited access administrator', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          permission_level: 'specific_clients',
          client_access_scope: ['CLIENT_001', 'CLIENT_003']
        }]
      });

      const result = await getClientAccessScope('+6281234567890');

      expect(result).toEqual(['CLIENT_001', 'CLIENT_003']);
    });

    test('should return empty array for readonly administrator', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          permission_level: 'readonly',
          client_access_scope: null
        }]
      });

      const result = await getClientAccessScope('+6281234567890');

      expect(result).toEqual([]);
    });

    test('should return empty array for unauthorized administrator', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await getClientAccessScope('+6281234567890');

      expect(result).toEqual([]);
    });
  });

  describe('Phone Number Validation', () => {
    const validPhoneNumbers = [
      '+6281234567890',
      '+14155552222',
      '+447700900123',
      '+919876543210'
    ];

    const invalidPhoneNumbers = [
      '6281234567890', // Missing +
      '+628123456789a', // Contains letter
      '+628-123-456-789', // Contains hyphens
      '+00123456789', // Invalid country code
      '+62812345678901234567890' // Too long
    ];

    test.each(validPhoneNumbers)('should accept valid phone number: %s', async (phoneNumber) => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await isAuthorizedAdministrator(phoneNumber);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.any(String),
        [phoneNumber]
      );
    });
  });
});