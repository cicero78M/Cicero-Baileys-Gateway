// src/repository/configSessionRepository.js
// Configuration Session Repository - WhatsApp Configuration Management
// CRUD operations for configuration session state management

import { SessionValidation } from '../model/configSessionModel.js';

/**
 * Create a new configuration session
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {Object} sessionData - Session data to create
 * @returns {Promise<Object>} Created session data
 */
export async function createSession(pool, sessionData) {
  // Validate session data before insertion
  const validation = SessionValidation.validateSessionData(sessionData);
  if (!validation.isValid) {
    throw new Error(`Invalid session data: ${validation.errors.join(', ')}`);
  }

  const result = await pool.query(
    `INSERT INTO client_config_sessions (
       session_id, phone_number, client_id, current_stage, configuration_group,
       pending_changes, original_state, timeout_extensions, expires_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      sessionData.session_id,
      sessionData.phone_number,
      sessionData.client_id,
      sessionData.current_stage,
      sessionData.configuration_group || null,
      JSON.stringify(sessionData.pending_changes || {}),
      JSON.stringify(sessionData.original_state || {}),
      sessionData.timeout_extensions || 0,
      sessionData.expires_at,
      sessionData.created_at || new Date(),
      sessionData.updated_at || new Date()
    ]
  );

  return result.rows[0];
}

/**
 * Get session by session ID
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} sessionId - Session ID to retrieve
 * @returns {Promise<Object|null>} Session data or null if not found
 */
export async function getSessionById(pool, sessionId) {
  const result = await pool.query(
    'SELECT * FROM client_config_sessions WHERE session_id = $1',
    [sessionId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const session = result.rows[0];
  return {
    ...session,
    pending_changes: session.pending_changes || {},
    original_state: session.original_state || {}
  };
}

/**
 * Get active session by phone number (enforce one session per phone)
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} phoneNumber - Phone number to find session for
 * @returns {Promise<Object|null>} Active session data or null if not found
 */
export async function getActiveSessionByPhone(pool, phoneNumber) {
  const result = await pool.query(
    'SELECT * FROM client_config_sessions WHERE phone_number = $1 AND expires_at > NOW()',
    [phoneNumber]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const session = result.rows[0];
  return {
    ...session,
    pending_changes: session.pending_changes || {},
    original_state: session.original_state || {}
  };
}

/**
 * Update session stage and related data
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} sessionId - Session ID to update
 * @param {Object} updates - Updates to apply
 * @returns {Promise<Object|null>} Updated session data or null if not found
 */
export async function updateSession(pool, sessionId, updates) {
  const updateFields = [];
  const updateValues = [];
  let paramIndex = 1;

  // Build dynamic update query
  for (const [field, value] of Object.entries(updates)) {
    switch (field) {
      case 'current_stage':
        if (!SessionValidation.isValidStage(value)) {
          throw new Error(`Invalid session stage: ${value}`);
        }
        updateFields.push(`current_stage = $${paramIndex++}`);
        updateValues.push(value);
        break;
        
      case 'configuration_group':
        updateFields.push(`configuration_group = $${paramIndex++}`);
        updateValues.push(value);
        break;
        
      case 'pending_changes':
        updateFields.push(`pending_changes = $${paramIndex++}`);
        updateValues.push(JSON.stringify(value || {}));
        break;
        
      case 'original_state':
        updateFields.push(`original_state = $${paramIndex++}`);
        updateValues.push(JSON.stringify(value || {}));
        break;
        
      case 'timeout_extensions':
        updateFields.push(`timeout_extensions = $${paramIndex++}`);
        updateValues.push(value);
        break;
        
      case 'expires_at':
        updateFields.push(`expires_at = $${paramIndex++}`);
        updateValues.push(value);
        break;
    }
  }

  if (updateFields.length === 0) {
    throw new Error('No valid update fields provided');
  }

  // Always update the updated_at timestamp
  updateFields.push(`updated_at = NOW()`);
  updateValues.push(sessionId);

  const query = `
    UPDATE client_config_sessions 
    SET ${updateFields.join(', ')}
    WHERE session_id = $${paramIndex}
    RETURNING *
  `;

  const result = await pool.query(query, updateValues);

  if (result.rows.length === 0) {
    return null;
  }

  const session = result.rows[0];
  return {
    ...session,
    pending_changes: session.pending_changes || {},
    original_state: session.original_state || {}
  };
}

/**
 * Delete session by session ID
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} sessionId - Session ID to delete
 * @returns {Promise<boolean>} True if session was deleted, false if not found
 */
export async function deleteSession(pool, sessionId) {
  const result = await pool.query(
    'DELETE FROM client_config_sessions WHERE session_id = $1',
    [sessionId]
  );

  return result.rowCount > 0;
}

/**
 * Delete session by phone number (cleanup for new session creation)
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} phoneNumber - Phone number to delete session for
 * @returns {Promise<boolean>} True if session was deleted, false if not found
 */
export async function deleteSessionByPhone(pool, phoneNumber) {
  const result = await pool.query(
    'DELETE FROM client_config_sessions WHERE phone_number = $1',
    [phoneNumber]
  );

  return result.rowCount > 0;
}

/**
 * Clean up expired sessions
 * @param {import('pg').Pool} pool - Database connection pool
 * @returns {Promise<number>} Number of expired sessions cleaned up
 */
export async function cleanupExpiredSessions(pool) {
  const result = await pool.query(
    'DELETE FROM client_config_sessions WHERE expires_at < NOW()'
  );

  return result.rowCount;
}

/**
 * Get all active sessions (for monitoring/debugging)
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {Object} [filters] - Optional filters
 * @returns {Promise<Array>} Array of active session data
 */
export async function getActiveSessions(pool, filters = {}) {
  let query = 'SELECT * FROM client_config_sessions WHERE expires_at > NOW()';
  const params = [];
  let paramIndex = 1;

  if (filters.clientId) {
    query += ` AND client_id = $${paramIndex++}`;
    params.push(filters.clientId);
  }

  if (filters.currentStage) {
    query += ` AND current_stage = $${paramIndex++}`;
    params.push(filters.currentStage);
  }

  query += ' ORDER BY created_at DESC';

  const result = await pool.query(query, params);

  return result.rows.map(session => ({
    ...session,
    pending_changes: session.pending_changes || {},
    original_state: session.original_state || {}
  }));
}

/**
 * Get sessions by client ID (for conflict detection)
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} clientId - Client ID to find sessions for
 * @returns {Promise<Array>} Array of active sessions for the client
 */
export async function getSessionsByClient(pool, clientId) {
  const result = await pool.query(
    'SELECT * FROM client_config_sessions WHERE client_id = $1 AND expires_at > NOW() ORDER BY created_at',
    [clientId]
  );

  return result.rows.map(session => ({
    ...session,
    pending_changes: session.pending_changes || {},
    original_state: session.original_state || {}
  }));
}

/**
 * Extend session timeout
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} sessionId - Session ID to extend
 * @param {number} extensionMs - Extension time in milliseconds
 * @returns {Promise<Object|null>} Updated session data or null if not found/max extensions reached
 */
export async function extendSessionTimeout(pool, sessionId, extensionMs = 10 * 60 * 1000) {
  const maxExtensions = 5;
  
  const result = await pool.query(
    `UPDATE client_config_sessions 
     SET 
       expires_at = expires_at + INTERVAL '${extensionMs} milliseconds',
       timeout_extensions = timeout_extensions + 1,
       updated_at = NOW()
     WHERE session_id = $1 
       AND timeout_extensions < $2 
       AND expires_at > NOW()
     RETURNING *`,
    [sessionId, maxExtensions]
  );

  if (result.rows.length === 0) {
    return null; // Session not found, expired, or max extensions reached
  }

  const session = result.rows[0];
  return {
    ...session,
    pending_changes: session.pending_changes || {},
    original_state: session.original_state || {}
  };
}

/**
 * Check if session is near expiry (for timeout warnings)
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} sessionId - Session ID to check
 * @param {number} warningMinutes - Minutes before expiry to trigger warning (default: 2)
 * @returns {Promise<boolean>} True if session is near expiry
 */
export async function isSessionNearExpiry(pool, sessionId, warningMinutes = 2) {
  const result = await pool.query(
    `SELECT 1 FROM client_config_sessions 
     WHERE session_id = $1 
       AND expires_at > NOW() 
       AND expires_at <= NOW() + INTERVAL '${warningMinutes} minutes'`,
    [sessionId]
  );

  return result.rows.length > 0;
}

/**
 * Add pending change to session
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} sessionId - Session ID to update
 * @param {string} configKey - Configuration key being changed
 * @param {string} oldValue - Current value
 * @param {string} newValue - New value
 * @returns {Promise<Object|null>} Updated session data or null if not found
 */
export async function addPendingChange(pool, sessionId, configKey, oldValue, newValue) {
  const session = await getSessionById(pool, sessionId);
  if (!session) {
    return null;
  }

  const pendingChanges = { ...session.pending_changes };
  pendingChanges[configKey] = {
    old_value: oldValue,
    new_value: newValue,
    changed_at: new Date().toISOString()
  };

  return await updateSession(pool, sessionId, { pending_changes: pendingChanges });
}

/**
 * Clear all pending changes from session
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} sessionId - Session ID to update
 * @returns {Promise<Object|null>} Updated session data or null if not found
 */
export async function clearPendingChanges(pool, sessionId) {
  return await updateSession(pool, sessionId, { pending_changes: {} });
}
