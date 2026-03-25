/**
 * T014 — pendingConfirmationStore.test.js
 * Tests: TTL, expiry, deletion, LRU eviction, overwrite
 */
import { jest } from '@jest/globals';
import {
  setConfirmation,
  getConfirmation,
  deleteConfirmation,
  getConfirmationStoreStat,
} from '../src/service/pendingConfirmationStore.js';

const DATA = { oldUsername: 'old_user', newUsername: 'new_user', nrp: '75020201' };

describe('pendingConfirmationStore', () => {
  // Use unique JID per test to avoid cross-test state pollution
  let testIdx = 0;
  function jid() {
    return `628${String(++testIdx).padStart(9, '0')}@s.whatsapp.net`;
  }

  // (a) set then get within TTL returns correct data
  test('(a) set then get within TTL returns correct data', () => {
    const id = jid();
    setConfirmation(id, 'instagram', DATA);
    const entry = getConfirmation(id, 'instagram');
    expect(entry).not.toBeNull();
    expect(entry.senderJid).toBe(id);
    expect(entry.platform).toBe('instagram');
    expect(entry.oldUsername).toBe('old_user');
    expect(entry.newUsername).toBe('new_user');
    expect(entry.nrp).toBe('75020201');
    expect(typeof entry.expiresAt).toBe('number');
  });

  // (b) get after TTL expired returns null
  test('(b) get after TTL expired returns null', () => {
    const id = jid();
    setConfirmation(id, 'tiktok', DATA);

    // Freeze Date.now to simulate expiry
    const realDateNow = Date.now.bind(Date);
    jest.spyOn(Date, 'now').mockReturnValue(realDateNow() + 16 * 60 * 1000);

    const entry = getConfirmation(id, 'tiktok');
    expect(entry).toBeNull();

    jest.restoreAllMocks();
  });

  // (c) expired entry is removed from store on get (no memory leak)
  test('(c) expired entry removed from Map on stale get', () => {
    const id = jid();
    setConfirmation(id, 'instagram', DATA);
    const { size: before } = getConfirmationStoreStat();

    const realDateNow = Date.now.bind(Date);
    jest.spyOn(Date, 'now').mockReturnValue(realDateNow() + 16 * 60 * 1000);

    getConfirmation(id, 'instagram'); // triggers eviction of stale entry
    const { size: after } = getConfirmationStoreStat();
    expect(after).toBeLessThan(before);

    jest.restoreAllMocks();
  });

  // (d) deleteConfirmation removes existing entry
  test('(d) deleteConfirmation removes entry', () => {
    const id = jid();
    setConfirmation(id, 'instagram', DATA);
    expect(getConfirmation(id, 'instagram')).not.toBeNull();
    deleteConfirmation(id, 'instagram');
    expect(getConfirmation(id, 'instagram')).toBeNull();
  });

  // (e) getConfirmation on missing key returns null
  test('(e) getConfirmation on unknown key returns null', () => {
    expect(getConfirmation('628999999999@s.whatsapp.net', 'instagram')).toBeNull();
  });

  // (f) inserting 1001 entries — oldest is evicted (LRU cap = 1000)
  test('(f) LRU eviction: 1001st entry evicts the oldest', () => {
    // Pre-fill store up to MAX (1000) with fresh entries
    const ids = [];
    for (let i = 0; i < 1000; i++) {
      ids.push(jid());
      setConfirmation(ids[ids.length - 1], 'instagram', DATA);
    }
    const oldest = ids[0];
    // Verify oldest is currently present
    expect(getConfirmation(oldest, 'instagram')).not.toBeNull();

    // Insert one more — should evict oldest
    const overflowId = jid();
    setConfirmation(overflowId, 'instagram', DATA);

    // oldest must be gone
    expect(getConfirmation(oldest, 'instagram')).toBeNull();
    // new entry must be present
    expect(getConfirmation(overflowId, 'instagram')).not.toBeNull();

    // Store size must not exceed 1000
    const { size, maxEntries } = getConfirmationStoreStat();
    expect(size).toBeLessThanOrEqual(maxEntries);
  });

  // (g) setConfirmation on existing key overwrites data and renews TTL
  test('(g) setConfirmation overwrites data and renews TTL on existing key', () => {
    const id = jid();
    setConfirmation(id, 'instagram', { ...DATA, newUsername: 'first' });
    const first = getConfirmation(id, 'instagram');
    const firstExpiry = first.expiresAt;

    // Slight delay to ensure expiresAt differs
    const realDateNow = Date.now.bind(Date);
    jest.spyOn(Date, 'now').mockReturnValue(realDateNow() + 1000);
    setConfirmation(id, 'instagram', { ...DATA, newUsername: 'second' });
    jest.restoreAllMocks();

    const second = getConfirmation(id, 'instagram');
    expect(second.newUsername).toBe('second');
    expect(second.expiresAt).toBeGreaterThan(firstExpiry);
  });

  // getConfirmationStoreStat returns expected shape
  test('getConfirmationStoreStat returns { size, maxEntries }', () => {
    const stat = getConfirmationStoreStat();
    expect(typeof stat.size).toBe('number');
    expect(stat.maxEntries).toBe(1000);
  });
});
