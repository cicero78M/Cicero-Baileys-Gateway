/**
 * operatorRegistrationSessionRepository.js
 * DB access layer for the operator_registration_sessions table.
 * All queries are parameterized to prevent SQL injection.
 */

/**
 * Find an active (non-expired) session for the given phone number.
 *
 * @param {import('pg').Pool} pool
 * @param {string} phoneNumber
 * @returns {Promise<object|null>}
 */
export async function findActiveSession(pool, phoneNumber) {
  const result = await pool.query(
    `SELECT phone_number, stage, original_message, expires_at, attempt_count, first_attempt_at, created_at, updated_at
     FROM operator_registration_sessions
     WHERE phone_number = $1 AND expires_at > NOW()`,
    [phoneNumber]
  );
  return result.rows[0] ?? null;
}

/**
 * Upsert a registration session.
 * - If the phone_number row does not exist: insert with attempt_count=1.
 * - On conflict (existing row):
 *   - If NOW()-first_attempt_at >= cooldown interval: reset attempt_count=1, first_attempt_at=NOW()
 *   - Otherwise: increment attempt_count
 * - Always updates stage, original_message, expires_at, updated_at.
 *
 * @param {import('pg').Pool} pool
 * @param {string} phoneNumber
 * @param {string} stage
 * @param {string} originalMessage
 * @param {number} ttlSeconds
 * @param {number} cooldownMinutes
 * @returns {Promise<void>}
 */
export async function upsertSession(pool, phoneNumber, stage, originalMessage, ttlSeconds, cooldownMinutes) {
  await pool.query(
    `INSERT INTO operator_registration_sessions
       (phone_number, stage, original_message, expires_at, attempt_count, first_attempt_at, created_at, updated_at)
     VALUES
       ($1, $2, $3, NOW() + ($4 || ' seconds')::interval, 1, NOW(), NOW(), NOW())
     ON CONFLICT (phone_number) DO UPDATE SET
       stage = EXCLUDED.stage,
       original_message = EXCLUDED.original_message,
       expires_at = NOW() + ($4 || ' seconds')::interval,
       updated_at = NOW(),
       attempt_count = CASE
         WHEN NOW() - operator_registration_sessions.first_attempt_at >= ($5 || ' minutes')::interval
         THEN 1
         ELSE operator_registration_sessions.attempt_count + 1
       END,
       first_attempt_at = CASE
         WHEN NOW() - operator_registration_sessions.first_attempt_at >= ($5 || ' minutes')::interval
         THEN NOW()
         ELSE operator_registration_sessions.first_attempt_at
       END`,
    [phoneNumber, stage, originalMessage, String(ttlSeconds), String(cooldownMinutes)]
  );
}

/**
 * Delete a session by phone number (called after successful/declined registration).
 *
 * @param {import('pg').Pool} pool
 * @param {string} phoneNumber
 * @returns {Promise<void>}
 */
export async function deleteSession(pool, phoneNumber) {
  await pool.query(
    `DELETE FROM operator_registration_sessions WHERE phone_number = $1`,
    [phoneNumber]
  );
}

/**
 * Check if a phone number is rate-limited for registration attempts.
 * Returns true when: session exists AND attempt_count >= maxAttempts AND
 * NOW()-first_attempt_at < cooldown interval.
 *
 * @param {import('pg').Pool} pool
 * @param {string} phoneNumber
 * @param {number} maxAttempts
 * @param {number} cooldownMinutes
 * @returns {Promise<boolean>}
 */
export async function isRateLimited(pool, phoneNumber, maxAttempts, cooldownMinutes) {
  const result = await pool.query(
    `SELECT
       (attempt_count >= $2 AND NOW() - first_attempt_at < ($3 || ' minutes')::interval) AS rate_limited
     FROM operator_registration_sessions
     WHERE phone_number = $1`,
    [phoneNumber, maxAttempts, String(cooldownMinutes)]
  );
  if (result.rows.length === 0) return false;
  return result.rows[0].rate_limited === true;
}

/**
 * Delete all expired sessions from the table.
 * Returns the number of rows deleted.
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<number>}
 */
export async function purgeExpiredSessions(pool) {
  const result = await pool.query(
    `DELETE FROM operator_registration_sessions WHERE expires_at <= NOW()`
  );
  return result.rowCount ?? 0;
}
