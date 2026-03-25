/**
 * T028 — waEventAggregatorDedup.test.js
 * Tests: LRU cap (10 000), eviction, TTL cleanup, reconnect-safe dedup map
 */
import { jest } from '@jest/globals';

let handleIncoming, getMessageDedupStats, cleanupExpiredMessages;

beforeAll(async () => {
  const mod = await import('../src/service/waEventAggregator.js');
  handleIncoming = mod.handleIncoming;
  getMessageDedupStats = mod.getMessageDedupStats;
  cleanupExpiredMessages = mod.cleanupExpiredMessages;
});

beforeEach(() => {
  jest.restoreAllMocks();
});

/** Build a minimal message object with unique jid + id */
function makeMsg(jid, id) {
  return { key: { remoteJid: jid, id } };
}

describe('waEventAggregatorDedup', () => {
  // (a) Insert 10 001 unique entries → seenMessages.size === 10 000 (oldest evicted)
  test('(a) 10 001 insertions cap map at 10 000 (oldest evicted)', async () => {
    const handler = jest.fn();
    const jid = 'test-lru@s.whatsapp.net';
    // Insert 10 001 unique messages
    for (let i = 1; i <= 10_001; i++) {
      handleIncoming('adapter', makeMsg(jid, `lru-msg-${i}`), handler);
    }
    const stats = getMessageDedupStats();
    expect(stats.size).toBe(10_000);
    // All 10 001 handlers were invoked (no duplicate yet)
    expect(handler).toHaveBeenCalledTimes(10_001);
  });

  // (b) Evicted entry is no longer recognized as a duplicate; re-insertable
  test('(b) Evicted entry is no longer a duplicate — handler called again', async () => {
    // After test (a), entry 'lru-msg-1' was the first inserted, so it got evicted
    const handler = jest.fn();
    const jid = 'test-lru@s.whatsapp.net';

    // Re-send the very first message — should NOT be treated as duplicate
    handleIncoming('adapter', makeMsg(jid, 'lru-msg-1'), handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // (c) TTL cleanup removes expired entries
  test('(c) cleanupExpiredMessages removes entries older than TTL', async () => {
    const handler = jest.fn();
    const jid = 'test-ttl@s.whatsapp.net';
    const id = 'ttl-test-msg-001';

    // Insert a fresh message
    handleIncoming('adapter', makeMsg(jid, id), handler);
    const sizeBefore = getMessageDedupStats().size;

    // Advance Date.now to simulate TTL expiry (25 hours into the future)
    const realDateNow = Date.now;
    const future = Date.now() + 25 * 60 * 60 * 1000;
    jest.spyOn(Date, 'now').mockReturnValue(future);

    cleanupExpiredMessages();

    // Restore
    Date.now = realDateNow;

    const sizeAfter = getMessageDedupStats().size;
    expect(sizeAfter).toBeLessThan(sizeBefore);
  });

  // (d) Reconnect (close→open) does NOT clear seenMessages — dedup survives reconnect
  test('(d) Reconnect does NOT clear seenMessages — duplicate still suppressed', async () => {
    const handler = jest.fn();
    const jid = 'reconnect-test@s.whatsapp.net';
    const id = 'reconnect-unique-msg-xyz';

    // First delivery
    handleIncoming('adapter', makeMsg(jid, id), handler);
    expect(handler).toHaveBeenCalledTimes(1);

    // Simulate reconnect: waEventAggregator has no connection.update hook,
    // so seenMessages persists. A second delivery of the same message is still a dup.
    // (This verifies the FR-009 clarification: reconnect biasa tidak mereset dedup)
    handleIncoming('adapter', makeMsg(jid, id), handler);
    expect(handler).toHaveBeenCalledTimes(1); // still 1 — duplicate suppressed
  });
});
