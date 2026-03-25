/**
 * pendingConfirmationStore.js
 * In-memory TTL store for pending username-change confirmations.
 * Max 1 000 entries with LRU eviction (oldest inserted first).
 * TTL: 15 minutes from creation (or last set).
 */

const MAX_ENTRIES = 1000;
const TTL_MS = 15 * 60 * 1000;

/** @type {Map<string, object>} — ordered by insertion time (oldest first) */
const store = new Map();

function makeKey(senderJid, platform) {
  return `${senderJid}:${platform}`;
}

/**
 * Store a pending confirmation entry, overwriting any existing entry for the
 * same key (TTL is also renewed).  Evicts the oldest entry if MAX_ENTRIES is
 * reached before inserting.
 *
 * @param {string} senderJid
 * @param {string} platform  'instagram' | 'tiktok'
 * @param {{ oldUsername: string, newUsername: string, nrp: string }} data
 */
export function setConfirmation(senderJid, platform, data) {
  const key = makeKey(senderJid, platform);

  // Overwrite: delete first so insertion order places it at the end
  if (store.has(key)) {
    store.delete(key);
  } else if (store.size >= MAX_ENTRIES) {
    // Evict oldest entry (first key in Map iteration order)
    const oldestKey = store.keys().next().value;
    store.delete(oldestKey);
  }

  store.set(key, {
    senderJid,
    platform,
    oldUsername: data.oldUsername,
    newUsername: data.newUsername,
    nrp: data.nrp,
    expiresAt: Date.now() + TTL_MS,
  });
}

/**
 * Retrieve a pending confirmation.  Returns null if not found or expired.
 * Expired entries are eagerly removed from the store.
 *
 * @param {string} senderJid
 * @param {string} platform
 * @returns {object|null}
 */
export function getConfirmation(senderJid, platform) {
  const key = makeKey(senderJid, platform);
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry;
}

/**
 * Delete a pending confirmation entry (e.g. after it has been acted on).
 *
 * @param {string} senderJid
 * @param {string} platform
 */
export function deleteConfirmation(senderJid, platform) {
  store.delete(makeKey(senderJid, platform));
}

/**
 * Return store statistics for health/monitoring endpoints.
 * @returns {{ size: number, maxEntries: number }}
 */
export function getConfirmationStoreStat() {
  return { size: store.size, maxEntries: MAX_ENTRIES };
}
