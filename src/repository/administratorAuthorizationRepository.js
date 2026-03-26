// src/repository/administratorAuthorizationRepository.js
// Administrator Authorization Repository - WhatsApp Configuration Management
// Permission checks and authorization management

import { query } from './db.js';
import { PhoneNumberUtils, AuthorizationValidation, PERMISSION_LEVELS } from '../model/administratorAuthorizationModel.js';

/**
 * Get administrator authorization by phone number
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} phoneNumber - Phone number to check authorization for
 * @returns {Promise<Object|null>} Authorization data or null if not found
 */
export async function getAuthorizationByPhone(pool, phoneNumber) {
  const normalizedPhone = PhoneNumberUtils.normalize(phoneNumber);
  if (!normalizedPhone) {
    return null; // Invalid phone number format
  }

  const result = await pool.query(
    'SELECT * FROM administrator_authorization WHERE phone_number = $1',
    [normalizedPhone]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const authData = result.rows[0];
  return {
    ...authData,
    client_access_scope: authData.client_access_scope || []
  };
}

/**
 * Check if phone number is authorized for configuration management
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} phoneNumber - Phone number to check
 * @returns {Promise<boolean>} True if authorized, false otherwise
 */
export async function isPhoneAuthorized(pool, phoneNumber) {
  const authData = await getAuthorizationByPhone(pool, phoneNumber);
  return authData?.is_authorized === true;
}

/**
 * Check if phone number can access a specific client
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} phoneNumber - Phone number to check
 * @param {string} clientId - Client ID to check access for
 * @returns {Promise<boolean>} True if can access client, false otherwise
 */
export async function canAccessClient(pool, phoneNumber, clientId) {
  const authData = await getAuthorizationByPhone(pool, phoneNumber);
  if (!authData || !authData.is_authorized) {
    return false;
  }

  // Full permission allows access to all clients
  if (authData.permission_level === PERMISSION_LEVELS.FULL) {
    return true;
  }

  // Readonly permission allows viewing all clients
  if (authData.permission_level === PERMISSION_LEVELS.READONLY) {
    return true;
  }

  // Specific clients permission requires client ID to be in scope
  if (authData.permission_level === PERMISSION_LEVELS.SPECIFIC_CLIENTS) {
    const clientScope = authData.client_access_scope || [];
    return clientScope.includes(clientId);
  }

  return false;
}

/**
 * Check if phone number can modify a specific client's configuration
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} phoneNumber - Phone number to check
 * @param {string} clientId - Client ID to check modification rights for
 * @returns {Promise<boolean>} True if can modify client configuration, false otherwise
 */
export async function canModifyClient(pool, phoneNumber, clientId) {
  const authData = await getAuthorizationByPhone(pool, phoneNumber);
  if (!authData || !authData.is_authorized) {
    return false;
  }

  // Readonly permission cannot modify
  if (authData.permission_level === PERMISSION_LEVELS.READONLY) {
    return false;
  }

  // Check access permission first (full or specific clients)
  return await canAccessClient(pool, phoneNumber, clientId);
}

/**
 * Get accessible client IDs for a phone number
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} phoneNumber - Phone number to get accessible clients for
 * @param {Array<string>} allClientIds - All available client IDs in the system
 * @returns {Promise<Array<string>>} Array of client IDs the phone number can access
 */
export async function getAccessibleClients(pool, phoneNumber, allClientIds) {
  const authData = await getAuthorizationByPhone(pool, phoneNumber);
  if (!authData || !authData.is_authorized) {
    return [];
  }

  // Full and readonly permissions allow access to all clients
  if ([PERMISSION_LEVELS.FULL, PERMISSION_LEVELS.READONLY].includes(authData.permission_level)) {
    return [...allClientIds];
  }

  // Specific clients permission filters by scope
  if (authData.permission_level === PERMISSION_LEVELS.SPECIFIC_CLIENTS) {
    const clientScope = authData.client_access_scope || [];
    return allClientIds.filter(clientId => clientScope.includes(clientId));
  }

  return [];
}

/**
 * Create new administrator authorization
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} phoneNumber - Phone number to authorize
 * @param {Object} options - Authorization options
 * @returns {Promise<Object>} Created authorization data
 */
export async function createAuthorization(pool, phoneNumber, {
  permissionLevel = PERMISSION_LEVELS.FULL,
  clientAccessScope = [],
  isAuthorized = true
} = {}) {
  const normalizedPhone = PhoneNumberUtils.normalize(phoneNumber);
  if (!normalizedPhone) {
    throw new Error(`Invalid phone number format: ${phoneNumber}`);
  }

  const authData = {
    phone_number: normalizedPhone,
    is_authorized: isAuthorized,
    permission_level: permissionLevel,
    client_access_scope: clientAccessScope,
    created_at: new Date(),
    updated_at: new Date()
  };

  // Validate authorization data
  const validation = AuthorizationValidation.validateAuthorizationData(authData);
  if (!validation.isValid) {
    throw new Error(`Invalid authorization data: ${validation.errors.join(', ')}`);
  }

  const result = await pool.query(
    `INSERT INTO administrator_authorization 
     (phone_number, is_authorized, client_access_scope, permission_level, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      authData.phone_number,
      authData.is_authorized,
      JSON.stringify(authData.client_access_scope),
      authData.permission_level,
      authData.created_at,
      authData.updated_at
    ]
  );

  const createdAuth = result.rows[0];
  return {
    ...createdAuth,
    client_access_scope: createdAuth.client_access_scope || []
  };
}

/**
 * Update administrator authorization
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} phoneNumber - Phone number to update
 * @param {Object} updates - Updates to apply
 * @returns {Promise<Object|null>} Updated authorization data or null if not found
 */
export async function updateAuthorization(pool, phoneNumber, updates) {
  const normalizedPhone = PhoneNumberUtils.normalize(phoneNumber);
  if (!normalizedPhone) {
    throw new Error(`Invalid phone number format: ${phoneNumber}`);
  }

  const updateFields = [];
  const updateValues = [];
  let paramIndex = 1;

  // Build dynamic update query
  for (const [field, value] of Object.entries(updates)) {
    switch (field) {
      case 'is_authorized':
        if (typeof value !== 'boolean') {
          throw new Error('is_authorized must be boolean');
        }
        updateFields.push(`is_authorized = $${paramIndex++}`);
        updateValues.push(value);
        break;
        
      case 'permission_level':
        if (!Object.values(PERMISSION_LEVELS).includes(value)) {
          throw new Error(`Invalid permission level: ${value}`);
        }
        updateFields.push(`permission_level = $${paramIndex++}`);
        updateValues.push(value);
        break;
        
      case 'client_access_scope':
        if (!Array.isArray(value)) {
          throw new Error('client_access_scope must be array');
        }
        updateFields.push(`client_access_scope = $${paramIndex++}`);
        updateValues.push(JSON.stringify(value));
        break;
    }
  }

  if (updateFields.length === 0) {
    throw new Error('No valid update fields provided');
  }

  // Always update the updated_at timestamp
  updateFields.push(`updated_at = NOW()`);
  updateValues.push(normalizedPhone);

  const query = `
    UPDATE administrator_authorization 
    SET ${updateFields.join(', ')}
    WHERE phone_number = $${paramIndex}
    RETURNING *
  `;

  const result = await pool.query(query, updateValues);

  if (result.rows.length === 0) {
    return null;
  }

  const authData = result.rows[0];
  return {
    ...authData,
    client_access_scope: authData.client_access_scope || []
  };
}

/**
 * Revoke administrator authorization
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} phoneNumber - Phone number to revoke authorization for
 * @returns {Promise<boolean>} True if revoked, false if not found
 */
export async function revokeAuthorization(pool, phoneNumber) {
  const result = await updateAuthorization(pool, phoneNumber, {
    is_authorized: false,
    permission_level: PERMISSION_LEVELS.READONLY,
    client_access_scope: []
  });

  return result !== null;
}

/**
 * Grant full authorization to phone number
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} phoneNumber - Phone number to grant full access to
 * @returns {Promise<Object|null>} Updated authorization data or null if not found
 */
export async function grantFullAccess(pool, phoneNumber) {
  return await updateAuthorization(pool, phoneNumber, {
    is_authorized: true,
    permission_level: PERMISSION_LEVELS.FULL,
    client_access_scope: []
  });
}

/**
 * Set specific client access scope for phone number
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} phoneNumber - Phone number to update
 * @param {Array<string>} clientIds - Array of client IDs to grant access to
 * @returns {Promise<Object|null>} Updated authorization data or null if not found
 */
export async function setClientAccessScope(pool, phoneNumber, clientIds) {
  if (!Array.isArray(clientIds)) {
    throw new Error('clientIds must be an array');
  }

  return await updateAuthorization(pool, phoneNumber, {
    is_authorized: true,
    permission_level: PERMISSION_LEVELS.SPECIFIC_CLIENTS,
    client_access_scope: clientIds
  });
}

/**
 * Delete administrator authorization
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} phoneNumber - Phone number to delete authorization for
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
export async function deleteAuthorization(pool, phoneNumber) {
  const normalizedPhone = PhoneNumberUtils.normalize(phoneNumber);
  if (!normalizedPhone) {
    return false;
  }

  const result = await pool.query(
    'DELETE FROM administrator_authorization WHERE phone_number = $1',
    [normalizedPhone]
  );

  return result.rowCount > 0;
}

/**
 * Get all administrator authorizations (for management purposes)
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {Object} [filters] - Optional filters
 * @returns {Promise<Array>} Array of authorization data
 */
export async function getAllAuthorizations(pool, filters = {}) {
  let query = 'SELECT * FROM administrator_authorization';
  const params = [];
  let paramIndex = 1;
  const whereConditions = [];

  if (filters.isAuthorized !== undefined) {
    whereConditions.push(`is_authorized = $${paramIndex++}`);
    params.push(filters.isAuthorized);
  }

  if (filters.permissionLevel) {
    whereConditions.push(`permission_level = $${paramIndex++}`);
    params.push(filters.permissionLevel);
  }

  if (whereConditions.length > 0) {
    query += ` WHERE ${whereConditions.join(' AND ')}`;
  }

  query += ' ORDER BY created_at DESC';

  const result = await pool.query(query, params);

  return result.rows.map(authData => ({
    ...authData,
    client_access_scope: authData.client_access_scope || []
  }));
}

/**
 * Check how many administrators can access a specific client
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} clientId - Client ID to check
 * @returns {Promise<number>} Number of administrators who can access the client
 */
export async function countAdministratorsForClient(pool, clientId) {
  const result = await pool.query(
    `SELECT COUNT(*) as count
     FROM administrator_authorization 
     WHERE is_authorized = true AND (
       permission_level IN ('full', 'readonly') OR 
       (permission_level = 'specific_clients' AND client_access_scope @> $1)
     )`,
    [JSON.stringify([clientId])]
  );

  return parseInt(result.rows[0].count);
}

/**
 * Get authorization statistics for monitoring
 * @param {import('pg').Pool} pool - Database connection pool
 * @returns {Promise<Object>} Authorization statistics
 */
export async function getAuthorizationStats(pool) {
  const result = await pool.query(
    `SELECT 
       COUNT(*) as total_admins,
       COUNT(*) FILTER (WHERE is_authorized = true) as authorized_admins,
       COUNT(*) FILTER (WHERE permission_level = 'full') as full_access_admins,
       COUNT(*) FILTER (WHERE permission_level = 'readonly') as readonly_admins,
       COUNT(*) FILTER (WHERE permission_level = 'specific_clients') as limited_access_admins
     FROM administrator_authorization`
  );

  return result.rows[0];
}