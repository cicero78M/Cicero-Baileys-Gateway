/**
 * T030 — complaintRepository.test.js
 * Unit tests for all 4 functions in src/repository/complaintRepository.js
 * Uses a mock db (no real DB connection).
 */
import { jest } from '@jest/globals';

// Mock db.js so the global pool is never instantiated in tests
jest.unstable_mockModule('../src/repository/db.js', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

let getUserByNrp, getAuditCounts, updateUserSocialHandle, getLatestPost;

beforeAll(async () => {
  const repo = await import('../src/repository/complaintRepository.js');
  getUserByNrp = repo.getUserByNrp;
  getAuditCounts = repo.getAuditCounts;
  updateUserSocialHandle = repo.updateUserSocialHandle;
  getLatestPost = repo.getLatestPost;
});

function makeDb(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

describe('complaintRepository', () => {
  describe('getUserByNrp', () => {
    // (d) returns row object if found
    test('returns user row when DB has a matching record', async () => {
      const row = { user_id: '75020201', insta: '@tester', tiktok: '@tester', updated_at: '2025-01-01T00:00:00Z' };
      const db = makeDb(async () => ({ rows: [row] }));
      const result = await getUserByNrp('75020201', db);
      expect(result).toEqual(row);
      expect(db.query).toHaveBeenCalledTimes(1);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('FROM "user"');
      expect(params).toEqual(['75020201']);
    });

    // (d) returns null if no rows
    test('returns null when DB returns no rows', async () => {
      const db = makeDb(async () => ({ rows: [] }));
      const result = await getUserByNrp('99999999', db);
      expect(result).toBeNull();
    });
  });

  describe('getAuditCounts', () => {
    const windowStart = new Date('2026-02-01T09:00:00Z');
    const windowEnd   = new Date('2026-02-01T10:00:00Z');

    // (e) returns { recentCount, allTimeCount } per mock rows
    test('(e) returns { recentCount, allTimeCount } from instagram audit queries', async () => {
      const db = makeDb(async (sql, params) => ({
        rows: [{ total: params.length === 1 ? 7 : 3 }],
      }));

      const result = await getAuditCounts('tester_ig', 'instagram', { windowStart, windowEnd }, db);
      expect(result).toEqual({ recentCount: 3, allTimeCount: 7 });
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    test('returns { recentCount, allTimeCount } from tiktok audit queries', async () => {
      const db = makeDb(async (sql, params) => ({
        rows: [{ total: params.length === 1 ? 5 : 2 }],
      }));

      const result = await getAuditCounts('@tester_tt', 'tiktok', { windowStart, windowEnd }, db);
      expect(result).toEqual({ recentCount: 2, allTimeCount: 5 });
    });

    test('returns zero counts when username is empty', async () => {
      const db = makeDb(async () => ({ rows: [] }));
      const result = await getAuditCounts('', 'instagram', { windowStart, windowEnd }, db);
      expect(result).toEqual({ recentCount: 0, allTimeCount: 0 });
      expect(db.query).not.toHaveBeenCalled();
    });

    test('returns zero counts for unknown platform', async () => {
      const db = makeDb(async () => ({ rows: [] }));
      const result = await getAuditCounts('user', 'facebook', { windowStart, windowEnd }, db);
      expect(result).toEqual({ recentCount: 0, allTimeCount: 0 });
    });

    test('recent-count query uses 3 params; allTime query uses 1 param', async () => {
      const db = makeDb(async (sql, params) => ({ rows: [{ total: params.length }] }));
      const result = await getAuditCounts('user', 'instagram', { windowStart, windowEnd }, db);
      // recentCount = 3 (3 params), allTimeCount = 1 (1 param)
      expect(result.recentCount).toBe(3);
      expect(result.allTimeCount).toBe(1);
    });
  });

  describe('updateUserSocialHandle', () => {
    // (a) instagram: $1=handle, $2=userId
    test('(a) updates insta column with parameterized query for instagram', async () => {
      const db = makeDb(async () => ({ rows: [] }));
      await updateUserSocialHandle('75020201', 'instagram', '@new_handle', db);
      expect(db.query).toHaveBeenCalledTimes(1);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('SET insta');
      expect(params[0]).toBe('@new_handle');
      expect(params[1]).toBe('75020201');
    });

    test('updates tiktok column for tiktok platform', async () => {
      const db = makeDb(async () => ({ rows: [] }));
      await updateUserSocialHandle('75020201', 'tiktok', '@tt_handle', db);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('SET tiktok');
      expect(params[0]).toBe('@tt_handle');
      expect(params[1]).toBe('75020201');
    });

    // (b) throws for unknown platform
    test('(b) throws Error("Unknown platform") for unrecognised platform', async () => {
      const db = makeDb(async () => ({ rows: [] }));
      await expect(updateUserSocialHandle('123', 'facebook', 'handle', db)).rejects.toThrow('Unknown platform');
    });
  });

  describe('getLatestPost', () => {
    // (c) instagram → { shortcode } if row exists
    test('(c) returns { shortcode } for instagram when post exists', async () => {
      const db = makeDb(async () => ({ rows: [{ shortcode: 'ABC123' }] }));
      const result = await getLatestPost('client-01', 'instagram', db);
      expect(result).toEqual({ shortcode: 'ABC123' });
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('FROM insta_post');
      expect(params).toEqual(['client-01']);
    });

    // (c) returns null if no rows
    test('returns null when no instagram posts exist', async () => {
      const db = makeDb(async () => ({ rows: [] }));
      const result = await getLatestPost('client-01', 'instagram', db);
      expect(result).toBeNull();
    });

    test('returns { videoId } for tiktok when post exists', async () => {
      const db = makeDb(async () => ({ rows: [{ video_id: 'VID456' }] }));
      const result = await getLatestPost('client-01', 'tiktok', db);
      expect(result).toEqual({ videoId: 'VID456' });
    });

    test('returns null for unknown platform', async () => {
      const db = makeDb(async () => ({ rows: [] }));
      const result = await getLatestPost('client-01', 'facebook', db);
      expect(result).toBeNull();
    });
  });
});
