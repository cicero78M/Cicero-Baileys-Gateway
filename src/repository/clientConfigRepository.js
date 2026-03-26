/**
 * clientConfigRepository.js
 * DB access layer for the client_config table.
 * All queries are parameterized to prevent SQL injection.
 * Extended for WhatsApp Configuration Management feature.
 */

import { buildConfigSelect, isValidConfigGroup } from '../model/clientConfigModel.js';

/**
 * Get a single config value by (clientId, configKey).
 * Returns the value string or null if not found.
 * @param {import('pg').Pool} pool
 * @param {string} clientId
 * @param {string} configKey
 * @returns {Promise<string|null>}
 */
export async function getConfigValue(pool, clientId, configKey) {
  const result = await pool.query(
    'SELECT config_value FROM client_config WHERE client_id = $1 AND config_key = $2',
    [clientId, configKey]
  );
  return result.rows[0]?.config_value ?? null;
}

/**
 * Get config value with automatic DEFAULT fallback.
 * First looks up (clientId, configKey); if not found, looks up ('DEFAULT', configKey).
 * Returns null if neither row exists.
 * @param {import('pg').Pool} pool
 * @param {string} clientId
 * @param {string} configKey
 * @returns {Promise<string|null>}
 */
export async function getConfigValueWithDefault(pool, clientId, configKey) {
  const result = await pool.query(
    `SELECT config_value FROM client_config
     WHERE (client_id = $1 OR client_id = 'DEFAULT') AND config_key = $2
     ORDER BY CASE WHEN client_id = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [clientId, configKey]
  );
  return result.rows[0]?.config_value ?? null;
}

/**
 * Upsert a config value for (clientId, configKey).
 * @param {import('pg').Pool} pool
 * @param {string} clientId
 * @param {string} configKey
 * @param {string} configValue
 * @returns {Promise<void>}
 */
export async function setConfigValue(pool, clientId, configKey, configValue) {
  await pool.query(
    `INSERT INTO client_config (client_id, config_key, config_value, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (client_id, config_key)
     DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
    [clientId, configKey, configValue]
  );
}

// ============================================================================
// EXTENDED METHODS FOR WHATSAPP CONFIGURATION MANAGEMENT
// ============================================================================

/**
 * Get all configuration entries for a client, optionally grouped by config_group.
 * Includes default fallback for missing client-specific configurations.
 * @param {import('pg').Pool} pool
 * @param {string} clientId - Client ID to get configuration for
 * @param {Object} options - Query options
 * @param {string} [options.configGroup] - Filter by specific config group
 * @param {boolean} [options.includeDefaults=true] - Include DEFAULT client fallbacks
 * @returns {Promise<Array>} Array of configuration entries
 */
export async function getClientConfiguration(pool, clientId, { configGroup = null, includeDefaults = true } = {}) {
  let query;
  let params;
  
  const selectColumns = await buildConfigSelect([
    'client_id', 'config_key', 'config_value', 'description'
  ]);
  
  if (configGroup) {
    if (!isValidConfigGroup(configGroup)) {
      throw new Error(`Invalid config group: ${configGroup}`);
    }
    
    if (includeDefaults) {
      query = `
        SELECT DISTINCT ON (config_key) ${selectColumns}
        FROM client_config 
        WHERE (client_id = $1 OR client_id = 'DEFAULT') AND config_group = $2
        ORDER BY config_key, CASE WHEN client_id = $1 THEN 0 ELSE 1 END
      `;
      params = [clientId, configGroup];
    } else {
      query = `SELECT ${selectColumns} FROM client_config WHERE client_id = $1 AND config_group = $2`;
      params = [clientId, configGroup];
    }
  } else {
    if (includeDefaults) {
      query = `
        SELECT DISTINCT ON (config_key) ${selectColumns}
        FROM client_config 
        WHERE (client_id = $1 OR client_id = 'DEFAULT')
        ORDER BY config_key, CASE WHEN client_id = $1 THEN 0 ELSE 1 END
      `;
      params = [clientId];
    } else {
      query = `SELECT ${selectColumns} FROM client_config WHERE client_id = $1`;
      params = [clientId];
    }
  }
  
  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Get configuration grouped by config_group for display purposes.
 * @param {import('pg').Pool} pool
 * @param {string} clientId - Client ID to get configuration for
 * @param {boolean} [includeDefaults=true] - Include DEFAULT client fallbacks
 * @returns {Promise<Object>} Configuration grouped by config_group
 */
export async function getClientConfigurationGrouped(pool, clientId, includeDefaults = true) {
  const selectColumns = await buildConfigSelect([
    'client_id', 'config_key', 'config_value', 'description', 'validation_pattern'
  ]);
  
  let query;
  let params;
  
  if (includeDefaults) {
    query = `
      SELECT DISTINCT ON (config_key) ${selectColumns}
      FROM client_config 
      WHERE (client_id = $1 OR client_id = 'DEFAULT') AND config_group IS NOT NULL
      ORDER BY config_key, CASE WHEN client_id = $1 THEN 0 ELSE 1 END
    `;
    params = [clientId];
  } else {
    query = `
      SELECT ${selectColumns}
      FROM client_config 
      WHERE client_id = $1 AND config_group IS NOT NULL
    `;
    params = [clientId];
  }
  
  const result = await pool.query(query, params);
  
  // Group by config_group
  const grouped = {};
  for (const row of result.rows) {
    const group = row.config_group;
    if (!grouped[group]) {
      grouped[group] = [];
    }
    grouped[group].push(row);
  }
  
  return grouped;
}

/**
 * Set multiple configuration values atomically within a transaction.
 * @param {import('pg').Pool} pool
 * @param {string} clientId - Client ID to update configuration for
 * @param {Object} configChanges - Object mapping config_key to new values
 * @param {Object} [options] - Update options
 * @param {string} [options.description] - Description for updated entries
 * @returns {Promise<Array>} Array of updated configuration entries
 */
export async function setMultipleConfigValues(pool, clientId, configChanges, { description = null } = {}) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const updatedEntries = [];
    
    for (const [configKey, configValue] of Object.entries(configChanges)) {
      let query;
      let params;
      
      if (description) {
        query = `
          INSERT INTO client_config (client_id, config_key, config_value, description, updated_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (client_id, config_key)
          DO UPDATE SET 
            config_value = EXCLUDED.config_value,
            description = EXCLUDED.description,
            updated_at = NOW()
          RETURNING *
        `;
        params = [clientId, configKey, configValue, description];
      } else {
        query = `
          INSERT INTO client_config (client_id, config_key, config_value, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (client_id, config_key)
          DO UPDATE SET 
            config_value = EXCLUDED.config_value,
            updated_at = NOW()
          RETURNING *
        `;
        params = [clientId, configKey, configValue];
      }
      
      const result = await client.query(query, params);
      updatedEntries.push(result.rows[0]);
    }
    
    await client.query('COMMIT');
    return updatedEntries;
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get configuration entry with validation pattern for input validation.
 * @param {import('pg').Pool} pool
 * @param {string} clientId - Client ID
 * @param {string} configKey - Configuration key
 * @param {boolean} [includeDefault=true] - Include DEFAULT client fallback
 * @returns {Promise<Object|null>} Configuration entry with validation_pattern
 */
export async function getConfigEntryWithValidation(pool, clientId, configKey, includeDefault = true) {
  const selectColumns = await buildConfigSelect([
    'client_id', 'config_key', 'config_value', 'description', 'validation_pattern'
  ]);
  
  let query;
  let params;
  
  if (includeDefault) {
    query = `
      SELECT ${selectColumns}
      FROM client_config 
      WHERE (client_id = $1 OR client_id = 'DEFAULT') AND config_key = $2
      ORDER BY CASE WHEN client_id = $1 THEN 0 ELSE 1 END
      LIMIT 1
    `;
    params = [clientId, configKey];
  } else {
    query = `SELECT ${selectColumns} FROM client_config WHERE client_id = $1 AND config_key = $2`;
    params = [clientId, configKey];
  }
  
  const result = await pool.query(query, params);
  return result.rows[0] || null;
}

/**
 * Get all template messages for Q&A workflow display.
 * @param {import('pg').Pool} pool
 * @param {string} [templateGroup='templates'] - Template group to filter
 * @returns {Promise<Object>} Object mapping template keys to values
 */
export async function getTemplateMessages(pool, templateGroup = 'templates') {
  const result = await pool.query(
    `SELECT config_key, config_value 
     FROM client_config 
     WHERE client_id = 'DEFAULT' AND config_group = $1`,
    [templateGroup]
  );
  
  const templates = {};
  for (const row of result.rows) {
    // Remove group prefix from key (e.g., 'templates.client_list_header' -> 'client_list_header')
    const templateKey = row.config_key.replace(`${templateGroup}.`, '');
    templates[templateKey] = row.config_value;
  }
  
  return templates;
}

/**
 * Check if a client has any custom configuration overrides.
 * @param {import('pg').Pool} pool
 * @param {string} clientId - Client ID to check
 * @returns {Promise<boolean>} True if client has custom configurations
 */
export async function hasCustomConfiguration(pool, clientId) {
  const result = await pool.query(
    'SELECT 1 FROM client_config WHERE client_id = $1 LIMIT 1',
    [clientId]
  );
  return result.rows.length > 0;
}

/**
 * Get configuration change history for a specific client and key.
 * Requires audit log integration for full history.
 * @param {import('pg').Pool} pool
 * @param {string} clientId - Client ID
 * @param {string} configKey - Configuration key
 * @returns {Promise<Array>} Array of configuration history entries
 */
export async function getConfigurationHistory(pool, clientId, configKey) {
  const result = await pool.query(
    `SELECT 
       cc.config_value,
       cc.updated_at,
       cal.old_value,
       cal.new_value,
       cal.phone_number as changed_by,
       cal.change_summary
     FROM client_config cc
     LEFT JOIN client_config_audit_log cal ON (
       cal.client_id = cc.client_id AND 
       cal.config_key = cc.config_key AND
       cal.action_type = 'modify_config'
     )
     WHERE cc.client_id = $1 AND cc.config_key = $2
     ORDER BY cc.updated_at DESC, cal.created_at DESC
     LIMIT 10`,
    [clientId, configKey]
  );
  return result.rows;
}
