/**
 * clientConfigRepository.js
 * DB access layer for the client_config table.
 * All queries are parameterized to prevent SQL injection.
 */

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
