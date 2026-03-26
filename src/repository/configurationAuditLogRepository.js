// src/repository/configurationAuditLogRepository.js
// Configuration Audit Log Repository - WhatsApp Configuration Management
// Audit trail logging and retrieval for compliance and tracking

import { query } from '../db/index.js';
import { AuditLogValidation, AuditLogQuery, AUDIT_ACTION_TYPES } from '../model/configurationAuditLogModel.js';

/**
 * Create new audit log entry
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {Object} logEntry - Audit log entry to create
 * @returns {Promise<Object>} Created audit log entry
 */
export async function createAuditLog(pool, logEntry) {
  // Validate log entry before insertion
  const validation = AuditLogValidation.validateLogEntry(logEntry);
  if (!validation.isValid) {
    throw new Error(`Invalid audit log entry: ${validation.errors.join(', ')}`);
  }

  const result = await pool.query(
    `INSERT INTO client_config_audit_log 
     (session_id, client_id, phone_number, action_type, config_key, old_value, new_value, change_summary, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      logEntry.session_id,
      logEntry.client_id,
      logEntry.phone_number,
      logEntry.action_type,
      logEntry.config_key || null,
      logEntry.old_value || null,
      logEntry.new_value || null,
      logEntry.change_summary,
      logEntry.created_at || new Date()
    ]
  );

  return result.rows[0];
}

/**
 * Create multiple audit log entries in a single transaction
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {Array<Object>} logEntries - Array of audit log entries to create
 * @returns {Promise<Array<Object>>} Array of created audit log entries
 */
export async function createMultipleAuditLogs(pool, logEntries) {
  if (!Array.isArray(logEntries) || logEntries.length === 0) {
    return [];
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const createdLogs = [];
    
    for (const logEntry of logEntries) {
      // Validate each entry
      const validation = AuditLogValidation.validateLogEntry(logEntry);
      if (!validation.isValid) {
        throw new Error(`Invalid audit log entry: ${validation.errors.join(', ')}`);
      }

      const result = await client.query(
        `INSERT INTO client_config_audit_log 
         (session_id, client_id, phone_number, action_type, config_key, old_value, new_value, change_summary, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          logEntry.session_id,
          logEntry.client_id,
          logEntry.phone_number,
          logEntry.action_type,
          logEntry.config_key || null,
          logEntry.old_value || null,
          logEntry.new_value || null,
          logEntry.change_summary,
          logEntry.created_at || new Date()
        ]
      );

      createdLogs.push(result.rows[0]);
    }
    
    await client.query('COMMIT');
    return createdLogs;
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get audit logs by session ID
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} sessionId - Session ID to get logs for
 * @returns {Promise<Array>} Array of audit log entries for the session
 */
export async function getAuditLogsBySession(pool, sessionId) {
  const result = await pool.query(
    'SELECT * FROM client_config_audit_log WHERE session_id = $1 ORDER BY created_at ASC',
    [sessionId]
  );

  return result.rows;
}

/**
 * Get audit logs by client ID with optional filtering
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} clientId - Client ID to get logs for
 * @param {Object} [options] - Query options
 * @returns {Promise<Array>} Array of audit log entries for the client
 */
export async function getAuditLogsByClient(pool, clientId, {
  limit = 100,
  offset = 0,
  actionType = null,
  phoneNumber = null,
  dateFrom = null,
  dateTo = null,
  sortBy = 'created_at',
  sortOrder = 'DESC'
} = {}) {
  const filters = {
    clientId,
    actionType,
    phoneNumber,
    dateFrom,
    dateTo
  };

  const { whereClause, parameters } = AuditLogQuery.buildSearchFilters(filters);
  const orderClause = AuditLogQuery.getDefaultSort(sortBy, sortOrder);

  // Add limit and offset parameters
  parameters.push(limit, offset);
  const limitOffset = `LIMIT $${parameters.length - 1} OFFSET $${parameters.length}`;

  const query = `
    SELECT * FROM client_config_audit_log 
    ${whereClause}
    ${orderClause}
    ${limitOffset}
  `;

  const result = await pool.query(query, parameters);
  return result.rows;
}

/**
 * Get audit logs by phone number (administrator activity tracking)
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} phoneNumber - Phone number to get logs for
 * @param {Object} [options] - Query options
 * @returns {Promise<Array>} Array of audit log entries for the phone number
 */
export async function getAuditLogsByPhoneNumber(pool, phoneNumber, {
  limit = 100,
  offset = 0,
  clientId = null,
  actionType = null,
  dateFrom = null,
  dateTo = null,
  sortBy = 'created_at',
  sortOrder = 'DESC'
} = {}) {
  const filters = {
    phoneNumber,
    clientId,
    actionType,
    dateFrom,
    dateTo
  };

  const { whereClause, parameters } = AuditLogQuery.buildSearchFilters(filters);
  const orderClause = AuditLogQuery.getDefaultSort(sortBy, sortOrder);

  // Add limit and offset parameters
  parameters.push(limit, offset);
  const limitOffset = `LIMIT $${parameters.length - 1} OFFSET $${parameters.length}`;

  const query = `
    SELECT * FROM client_config_audit_log 
    ${whereClause}
    ${orderClause}
    ${limitOffset}
  `;

  const result = await pool.query(query, parameters);
  return result.rows;
}

/**
 * Get configuration change history for a specific configuration key
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} clientId - Client ID
 * @param {string} configKey - Configuration key
 * @param {Object} [options] - Query options
 * @returns {Promise<Array>} Array of modification history entries
 */
export async function getConfigKeyHistory(pool, clientId, configKey, {
  limit = 50,
  includeAllActions = false
} = {}) {
  let query;
  let params;

  if (includeAllActions) {
    // Include all actions related to this config key
    query = `
      SELECT * FROM client_config_audit_log 
      WHERE client_id = $1 AND (config_key = $2 OR config_key IS NULL)
      ORDER BY created_at DESC
      LIMIT $3
    `;
    params = [clientId, configKey, limit];
  } else {
    // Only modification actions
    query = `
      SELECT * FROM client_config_audit_log 
      WHERE client_id = $1 AND config_key = $2 AND action_type = $3
      ORDER BY created_at DESC
      LIMIT $4
    `;
    params = [clientId, configKey, AUDIT_ACTION_TYPES.MODIFY_CONFIG, limit];
  }

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Get session summary statistics
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {string} sessionId - Session ID to get statistics for
 * @returns {Promise<Object>} Session statistics summary
 */
export async function getSessionStatistics(pool, sessionId) {
  const result = await pool.query(
    `SELECT 
       session_id,
       client_id,
       phone_number,
       MIN(created_at) as session_start,
       MAX(created_at) as session_end,
       COUNT(*) as total_actions,
       COUNT(*) FILTER (WHERE action_type = 'modify_config') as modifications,
       COUNT(*) FILTER (WHERE action_type = 'confirm_changes') as confirmations,
       COUNT(*) FILTER (WHERE action_type = 'rollback_session') as rollbacks,
       ARRAY_AGG(DISTINCT config_key) FILTER (WHERE config_key IS NOT NULL) as modified_keys
     FROM client_config_audit_log 
     WHERE session_id = $1
     GROUP BY session_id, client_id, phone_number`,
    [sessionId]
  );

  return result.rows[0] || null;
}

/**
 * Get audit statistics for a date range
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {Object} [options] - Query options
 * @returns {Promise<Object>} Audit statistics
 */
export async function getAuditStatistics(pool, {
  dateFrom = null,
  dateTo = null,
  clientId = null,
  phoneNumber = null
} = {}) {
  const filters = { dateFrom, dateTo, clientId, phoneNumber };
  const { whereClause, parameters } = AuditLogQuery.buildSearchFilters(filters);

  const query = `
    SELECT 
      COUNT(*) as total_actions,
      COUNT(DISTINCT session_id) as total_sessions,
      COUNT(DISTINCT client_id) as affected_clients,
      COUNT(DISTINCT phone_number) as active_administrators,
      COUNT(*) FILTER (WHERE action_type = 'modify_config') as total_modifications,
      COUNT(*) FILTER (WHERE action_type = 'confirm_changes') as confirmed_sessions,
      COUNT(*) FILTER (WHERE action_type = 'rollback_session') as rolled_back_sessions,
      COUNT(*) FILTER (WHERE action_type = 'extend_session') as session_extensions,
      AVG(CASE WHEN action_type = 'extend_session' THEN 1 ELSE 0 END) as avg_extensions_per_session
    FROM client_config_audit_log 
    ${whereClause}
  `;

  const result = await pool.query(query, parameters);
  return result.rows[0];
}

/**
 * Get most active administrators (by number of actions)
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {Object} [options] - Query options
 * @returns {Promise<Array>} Array of administrator activity statistics
 */
export async function getMostActiveAdministrators(pool, {
  limit = 10,
  dateFrom = null,
  dateTo = null
} = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (dateFrom) {
    conditions.push(`created_at >= $${paramIndex++}`);
    params.push(dateFrom);
  }

  if (dateTo) {
    conditions.push(`created_at <= $${paramIndex++}`);
    params.push(dateTo);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const query = `
    SELECT 
      phone_number,
      COUNT(*) as total_actions,
      COUNT(DISTINCT session_id) as total_sessions,
      COUNT(DISTINCT client_id) as clients_modified,
      COUNT(*) FILTER (WHERE action_type = 'modify_config') as total_modifications,
      COUNT(*) FILTER (WHERE action_type = 'confirm_changes') as confirmed_sessions,
      MAX(created_at) as last_activity
    FROM client_config_audit_log 
    ${whereClause}
    GROUP BY phone_number 
    ORDER BY total_actions DESC
    LIMIT $${params.length}
  `;

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Get most frequently modified configuration keys
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {Object} [options] - Query options
 * @returns {Promise<Array>} Array of configuration modification statistics
 */
export async function getMostModifiedConfigs(pool, {
  limit = 20,
  dateFrom = null,
  dateTo = null,
  clientId = null
} = {}) {
  const filters = { dateFrom, dateTo, clientId, actionType: AUDIT_ACTION_TYPES.MODIFY_CONFIG };
  const { whereClause, parameters } = AuditLogQuery.buildSearchFilters(filters);

  parameters.push(limit);

  const query = `
    SELECT 
      config_key,
      COUNT(*) as modification_count,
      COUNT(DISTINCT client_id) as affected_clients,
      COUNT(DISTINCT phone_number) as administrators_involved,
      COUNT(DISTINCT session_id) as sessions_involved,
      MAX(created_at) as last_modified
    FROM client_config_audit_log 
    ${whereClause}
    GROUP BY config_key 
    ORDER BY modification_count DESC
    LIMIT $${parameters.length}
  `;

  const result = await pool.query(query, parameters);
  return result.rows;
}

/**
 * Delete old audit logs beyond retention period
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {number} retentionDays - Number of days to retain logs (default: 365)
 * @returns {Promise<number>} Number of deleted audit log entries
 */
export async function cleanupOldAuditLogs(pool, retentionDays = 365) {
  const result = await pool.query(
    'DELETE FROM client_config_audit_log WHERE created_at < NOW() - INTERVAL \'%s days\'',
    [retentionDays]
  );

  return result.rowCount;
}

/**
 * Search audit logs with advanced filtering
 * @param {import('pg').Pool} pool - Database connection pool
 * @param {Object} searchCriteria - Search criteria
 * @returns {Promise<Object>} Search results with pagination info
 */
export async function searchAuditLogs(pool, {
  clientId = null,
  phoneNumber = null,
  actionType = null,
  configKey = null,
  dateFrom = null,
  dateTo = null,
  changeSummaryContains = null,
  page = 1,
  pageSize = 50,
  sortBy = 'created_at',
  sortOrder = 'DESC'
}) {
  const filters = { clientId, phoneNumber, actionType, configKey, dateFrom, dateTo };
  const { whereClause, parameters } = AuditLogQuery.buildSearchFilters(filters);
  
  let additionalWhereConditions = [];
  let paramIndex = parameters.length + 1;

  if (changeSummaryContains) {
    additionalWhereConditions.push(`change_summary ILIKE $${paramIndex++}`);
    parameters.push(`%${changeSummaryContains}%`);
  }

  // Combine where conditions
  let finalWhereClause = whereClause;
  if (additionalWhereConditions.length > 0) {
    const additionalWhere = additionalWhereConditions.join(' AND ');
    if (finalWhereClause) {
      finalWhereClause += ` AND ${additionalWhere}`;
    } else {
      finalWhereClause = `WHERE ${additionalWhere}`;
    }
  }

  // Count total results
  const countQuery = `SELECT COUNT(*) as total FROM client_config_audit_log ${finalWhereClause}`;
  const countResult = await pool.query(countQuery, parameters);
  const totalResults = parseInt(countResult.rows[0].total);

  // Calculate pagination
  const totalPages = Math.ceil(totalResults / pageSize);
  const offset = (page - 1) * pageSize;

  // Add pagination parameters
  parameters.push(pageSize, offset);
  
  const orderClause = AuditLogQuery.getDefaultSort(sortBy, sortOrder);
  const limitOffset = `LIMIT $${parameters.length - 1} OFFSET $${parameters.length}`;

  // Get paginated results
  const dataQuery = `
    SELECT * FROM client_config_audit_log 
    ${finalWhereClause}
    ${orderClause}
    ${limitOffset}
  `;

  const dataResult = await pool.query(dataQuery, parameters);

  return {
    results: dataResult.rows,
    pagination: {
      currentPage: page,
      pageSize,
      totalResults,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    }
  };
}