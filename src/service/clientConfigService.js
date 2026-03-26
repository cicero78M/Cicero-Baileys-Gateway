/**
 * clientConfigService.js
 * In-memory cached config service with lazy TTL and proactive eviction.
 * Wraps clientConfigRepository with a per-(clientId+configKey) cache.
 */

import { query } from '../db/postgres.js';
import {
  getConfigValueWithDefault,
  setConfigValue as repoSetConfigValue,
} from '../repository/clientConfigRepository.js';

const TTL_MS = 60_000;          // 60 s hard expiry per entry
const EVICTION_INTERVAL_MS = 120_000; // 120 s proactive sweep

/** @type {Map<string, { value: string|null, expiresAt: number }>} */
const cache = new Map();

let evictionTimer = null;

function startCacheEviction() {
  if (evictionTimer !== null) return;
  evictionTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) {
        cache.delete(key);
      }
    }
  }, EVICTION_INTERVAL_MS);

  // Don't hold the Node process open during tests
  if (evictionTimer.unref) evictionTimer.unref();
}

/**
 * Stop the background eviction timer (used in test teardown).
 */
export function stopCacheEviction() {
  if (evictionTimer !== null) {
    clearInterval(evictionTimer);
    evictionTimer = null;
  }
}

/**
 * Clear the entire in-memory cache (used in tests).
 */
export function clearCache() {
  cache.clear();
}

startCacheEviction();

/**
 * Build a deterministic cache key.
 * @param {string} clientId
 * @param {string} configKey
 * @returns {string}
 */
function cacheKey(clientId, configKey) {
  return `${clientId}::${configKey}`;
}

/**
 * A minimal pool proxy that delegates to the module-level `query` function,
 * allowing repository functions that take a pool object to work with the
 * shared connection pool.
 */
const poolProxy = {
  query: (sql, params) => query(sql, params),
};

/**
 * Get a config value for the given clientId and configKey.
 * Applies DEFAULT fallback (see getConfigValueWithDefault).
 * Result is cached for TTL_MS.
 *
 * @param {string} clientId
 * @param {string} configKey
 * @returns {Promise<string|null>}
 */
export async function getConfig(clientId, configKey) {
  const key = cacheKey(clientId, configKey);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await getConfigValueWithDefault(poolProxy, clientId, configKey);
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

/**
 * Like getConfig but returns `fallback` instead of null when no DB row found.
 *
 * @param {string} clientId
 * @param {string} configKey
 * @param {string} fallback
 * @returns {Promise<string>}
 */
export async function getConfigOrDefault(clientId, configKey, fallback) {
  const value = await getConfig(clientId, configKey);
  return value ?? fallback;
}

/**
 * Resolve which client_id owns the given WhatsApp group JID.
 * Query order:
 *  1. client_config WHERE config_key='group_jid' AND config_value=$1 → client_id
 *  2. clients table WHERE group_jid=$1 → client_id (legacy fallback)
 *  3. return null if neither found
 *
 * @param {string} groupJid
 * @returns {Promise<string|null>}
 */
export async function resolveClientIdForGroup(groupJid) {
  // 1. Check client_config table
  const confResult = await query(
    `SELECT client_id FROM client_config WHERE config_key = 'group_jid' AND config_value = $1 LIMIT 1`,
    [groupJid]
  );
  if (confResult.rows.length > 0) return confResult.rows[0].client_id;

  // 2. Legacy fallback: clients table
  const clientsResult = await query(
    `SELECT client_id FROM clients WHERE client_group = $1 LIMIT 1`,
    [groupJid]
  );
  if (clientsResult.rows.length > 0) return clientsResult.rows[0].client_id;

  return null;
}
