/**
 * operatorRepository.js
 * DB access layer for the operators table.
 * All queries are parameterized to prevent SQL injection.
 */

/**
 * Find an active operator by phone number.
 * Returns the DB row or null if not found / not active.
 *
 * @param {import('pg').Pool} pool
 * @param {string} phoneNumber
 * @returns {Promise<object|null>}
 */
export async function findActiveOperatorByPhone(pool, phoneNumber) {
  const result = await pool.query(
    `SELECT phone_number, client_id, satker_name, registered_at, is_active, created_at, updated_at
     FROM operators
     WHERE phone_number = $1 AND is_active = TRUE`,
    [phoneNumber]
  );
  return result.rows[0] ?? null;
}

/**
 * Upsert an operator record.
 * On conflict, updates client_id, satker_name, registered_at, updated_at,
 * and re-activates the account (is_active = TRUE).
 *
 * @param {import('pg').Pool} pool
 * @param {string} phoneNumber
 * @param {string} clientId
 * @param {string} satkerName
 * @returns {Promise<void>}
 */
export async function upsertOperator(pool, phoneNumber, clientId, satkerName) {
  await pool.query(
    `INSERT INTO operators (phone_number, client_id, satker_name, registered_at, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), TRUE, NOW(), NOW())
     ON CONFLICT (phone_number)
     DO UPDATE SET
       client_id = EXCLUDED.client_id,
       satker_name = EXCLUDED.satker_name,
       registered_at = NOW(),
       updated_at = NOW(),
       is_active = TRUE`,
    [phoneNumber, clientId, satkerName]
  );
}
