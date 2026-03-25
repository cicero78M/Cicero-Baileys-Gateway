/**
 * complaintRepository.js
 * Repository layer for complaint-triage DB operations.
 * Encapsulates all SQL — no inline queries in service files (Constitution I + VI).
 *
 * All functions accept an optional `db` parameter for test-injection.
 * When omitted, the global pool (query from ./db.js) is used automatically.
 */

import { query as globalQuery } from './db.js';

function normalizeHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

/** Resolve the query function: injected db (tests) or global pool (production). */
function q(db) {
  return db && typeof db.query === 'function'
    ? (sql, params) => db.query(sql, params)
    : globalQuery;
}

// ─── SQL Templates ──────────────────────────────────────────────────────────

const AUDIT_SQL = {
  instagram: ({ includeAllTime } = {}) => `
    SELECT COUNT(DISTINCT p.shortcode) AS total
    FROM insta_like l
    JOIN insta_post p ON p.shortcode = l.shortcode
    JOIN LATERAL (
      SELECT lower(replace(trim(COALESCE(elem->>'username', trim(both '"' FROM elem::text))), '@', '')) AS username
      FROM jsonb_array_elements(COALESCE(l.likes, '[]'::jsonb)) AS elem
    ) AS liked ON liked.username = $1
    ${includeAllTime ? '' : 'WHERE p.created_at BETWEEN $2::timestamptz AND $3::timestamptz'}
  `,
  tiktok: ({ includeAllTime } = {}) => `
    SELECT COUNT(DISTINCT c.video_id) AS total
    FROM tiktok_comment c
    JOIN tiktok_post p ON p.video_id = c.video_id
    JOIN LATERAL (
      SELECT lower(replace(trim(raw_username), '@', '')) AS username
      FROM jsonb_array_elements_text(COALESCE(c.comments, '[]'::jsonb)) AS raw(raw_username)
    ) AS commenter ON commenter.username = $1
    ${includeAllTime ? '' : 'WHERE p.created_at BETWEEN $2::timestamptz AND $3::timestamptz'}
  `,
};

async function runAuditQuery(dbFn, platform, normalizedUsername, { windowStart, windowEnd, includeAllTime = false } = {}) {
  const sqlFn = AUDIT_SQL[platform];
  if (!sqlFn) return 0;
  const sql = sqlFn({ includeAllTime });
  const params = includeAllTime
    ? [normalizedUsername]
    : [normalizedUsername, windowStart.toISOString(), windowEnd.toISOString()];
  const result = await dbFn(sql, params);
  const total = Number(result.rows?.[0]?.total || 0);
  return Number.isFinite(total) ? total : 0;
}

// ─── Exported Repository Functions ──────────────────────────────────────────

/**
 * Look up a user by NRP / user_id.
 * @param {string} nrp
 * @param {object} [db]  - optional injected DB for tests
 * @returns {object|null}
 */
export async function getUserByNrp(nrp, db) {
  const dbFn = q(db);
  const result = await dbFn(
    `SELECT user_id, nama, insta, tiktok, updated_at
     FROM "user"
     WHERE user_id = $1
     LIMIT 1`,
    [nrp],
  );
  return result.rows?.[0] || null;
}

/**
 * Fetch both recent-window and all-time audit counts for a social username.
 * @param {string} username
 * @param {string} platform  'instagram' | 'tiktok'
 * @param {{ windowStart: Date, windowEnd: Date }} options
 * @param {object} [db]  - optional injected DB for tests
 * @returns {{ recentCount: number, allTimeCount: number }}
 */
export async function getAuditCounts(username, platform, { windowStart, windowEnd }, db) {
  const normalized = normalizeHandle(username);
  if (!normalized) return { recentCount: 0, allTimeCount: 0 };

  const dbFn = q(db);
  const [recentCount, allTimeCount] = await Promise.all([
    runAuditQuery(dbFn, platform, normalized, { windowStart, windowEnd }),
    runAuditQuery(dbFn, platform, normalized, { includeAllTime: true }),
  ]);

  return { recentCount, allTimeCount };
}

/**
 * Update a user's social handle (insta or tiktok column).
 * @param {string} userId
 * @param {'instagram'|'tiktok'} platform
 * @param {string} handle
 * @param {object} [db]  - optional injected DB for tests
 */
export async function updateUserSocialHandle(userId, platform, handle, db) {
  const dbFn = q(db);
  if (platform === 'instagram') {
    await dbFn(`UPDATE "user" SET insta = $1 WHERE user_id = $2`, [handle, userId]);
  } else if (platform === 'tiktok') {
    await dbFn(`UPDATE "user" SET tiktok = $1 WHERE user_id = $2`, [handle, userId]);
  } else {
    throw new Error('Unknown platform');
  }
}

/**
 * Retrieve the most recent post for a given client and platform.
 * @param {string} clientId
 * @param {'instagram'|'tiktok'} platform
 * @param {object} [db]  - optional injected DB for tests
 * @returns {{ shortcode: string }|{ videoId: string }|null}
 */
export async function getLatestPost(clientId, platform, db) {
  const dbFn = q(db);
  if (platform === 'instagram') {
    const result = await dbFn(
      `SELECT shortcode FROM insta_post WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [clientId],
    );
    return result.rows?.[0]
      ? { shortcode: result.rows[0].shortcode }
      : null;
  }
  if (platform === 'tiktok') {
    const result = await dbFn(
      `SELECT video_id FROM tiktok_post WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [clientId],
    );
    return result.rows?.[0]
      ? { videoId: result.rows[0].video_id }
      : null;
  }
  return null;
}
