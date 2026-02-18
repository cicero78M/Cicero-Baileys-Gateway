import { jest } from '@jest/globals';
import { triageComplaint } from '../src/service/complaintTriageService.js';

function makeParsed(overrides = {}) {
  const { reporter: reporterOverride = {}, ...rest } = overrides || {};
  return {
    reporter: {
      nrp: '75020201',
      nama: 'Tester',
      polres: 'Polres',
      igUsername: '@tester',
      tiktokUsername: '@tester',
      ...reporterOverride,
    },
    issues: ['sudah komentar belum terdata'],
    ...rest,
  };
}

function makeDb(userRow, auditLike = 0, auditComment = 0, historicalLike = auditLike, historicalComment = auditComment) {
  const query = jest.fn(async (sql, params = []) => {
    if (sql.includes('FROM "user"')) {
      return { rows: userRow ? [userRow] : [] };
    }
    if (sql.includes('FROM insta_like')) {
      const total = params.length === 1 ? historicalLike : auditLike;
      return { rows: [{ total }] };
    }
    if (sql.includes('FROM tiktok_comment')) {
      const total = params.length === 1 ? historicalComment : auditComment;
      return { rows: [{ total }] };
    }
    return { rows: [] };
  });

  return { query };
}

describe('complaintTriageService', () => {
  test('returns USERNAME_MISMATCH when complaint username differs from DB', async () => {
    const parsed = makeParsed({ reporter: { igUsername: '@beda' } });
    const db = makeDb({ user_id: '75020201', insta: '@tester', tiktok: '@tester', updated_at: new Date().toISOString() }, 1, 1);

    const result = await triageComplaint(parsed, {
      db,
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({ exists: true, isPrivate: false })),
    });

    expect(result.diagnosisCode).toBe('USERNAME_MISMATCH');
  });

  test('returns ACCOUNT_PRIVATE when RapidAPI marks account private', async () => {
    const parsed = makeParsed();
    const db = makeDb({ user_id: '75020201', insta: '@tester', tiktok: '@tester', updated_at: new Date().toISOString() });

    const result = await triageComplaint(parsed, {
      db,
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({ exists: true, isPrivate: true })),
    });

    expect(result.diagnosisCode).toBe('ACCOUNT_PRIVATE');
  });

  test('returns LOW_TRUST when rapid profile has very low activity', async () => {
    const parsed = makeParsed();
    const db = makeDb({ user_id: '75020201', insta: '@tester', tiktok: '@tester', updated_at: new Date().toISOString() }, 1, 1);

    const result = await triageComplaint(parsed, {
      db,
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({
        exists: true,
        isPrivate: false,
        posts: 0,
        hasProfilePic: false,
        recentActivityScore: 3,
      })),
    });

    expect(result.diagnosisCode).toBe('LOW_TRUST');
  });



  test('returns SYNC_PENDING when recent audit is empty but historical audit exists', async () => {
    const parsed = makeParsed();
    const db = makeDb(
      { user_id: '75020201', insta: '@tester', tiktok: '@tester', updated_at: new Date().toISOString() },
      0,
      0,
      5,
      3
    );

    const result = await triageComplaint(parsed, {
      db,
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({ exists: true, isPrivate: false, posts: 20, hasProfilePic: true, recentActivityScore: 80 })),
    });

    expect(result.diagnosisCode).toBe('SYNC_PENDING');
    expect(result.nextActions[0].toLowerCase()).toContain('riwayat audit');
  });

  test('returns NOT_EXECUTED when both recent and historical audit are empty', async () => {
    const parsed = makeParsed();
    const db = makeDb({ user_id: '75020201', insta: '@tester', tiktok: '@tester', updated_at: new Date().toISOString() }, 0, 0, 0, 0);

    const result = await triageComplaint(parsed, {
      db,
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({ exists: true, isPrivate: false })),
    });

    expect(result.diagnosisCode).toBe('NOT_EXECUTED');
    expect(result.nextActions[0].toLowerCase()).toContain('data historis');
  });

  test('handles RAPIDAPI_UNAVAILABLE with fallback guidance', async () => {
    const parsed = makeParsed();
    const db = makeDb({ user_id: '75020201', insta: '@tester', tiktok: '@tester', updated_at: new Date().toISOString() });

    const rapidError = new Error('unavailable');
    rapidError.code = 'RAPIDAPI_UNAVAILABLE';

    const result = await triageComplaint(parsed, {
      db,
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => {
        throw rapidError;
      }),
    });

    expect(result.diagnosisCode).toBe('SYNC_PENDING');
    expect(result.operatorResponse.toLowerCase()).toContain('screenshot');
  });
});
