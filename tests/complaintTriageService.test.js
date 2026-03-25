import { jest } from '@jest/globals';

// Mock the repository so DB pool is never instantiated
jest.unstable_mockModule('../src/repository/complaintRepository.js', () => ({
  getUserByNrp: jest.fn(),
  getAuditCounts: jest.fn(),
  updateUserSocialHandle: jest.fn(),
  getLatestPost: jest.fn(),
}));

let triageComplaint;
let mockGetUserByNrp, mockGetAuditCounts;

beforeAll(async () => {
  const repo = await import('../src/repository/complaintRepository.js');
  mockGetUserByNrp = repo.getUserByNrp;
  mockGetAuditCounts = repo.getAuditCounts;
  const svc = await import('../src/service/complaintTriageService.js');
  triageComplaint = svc.triageComplaint;
});

beforeEach(() => {
  jest.clearAllMocks();
});

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

/**
 * Helper: configure the mocked repository functions.
 * auditLike/auditComment = recent counts; historicalLike/historicalComment = allTime counts.
 */
function setupRepoMocks(userRow, auditLike = 0, auditComment = 0, historicalLike = auditLike, historicalComment = auditComment) {
  mockGetUserByNrp.mockResolvedValue(userRow || null);
  mockGetAuditCounts.mockImplementation(async (username, platform) => {
    if (platform === 'instagram') return { recentCount: auditLike, allTimeCount: historicalLike };
    if (platform === 'tiktok') return { recentCount: auditComment, allTimeCount: historicalComment };
    return { recentCount: 0, allTimeCount: 0 };
  });
}

const baseUser = { user_id: '75020201', insta: '@tester', tiktok: '@tester', updated_at: new Date().toISOString() };

describe('complaintTriageService', () => {
  test('returns USERNAME_MISMATCH when complaint username differs from DB', async () => {
    const parsed = makeParsed({ reporter: { igUsername: '@beda' } });
    setupRepoMocks(baseUser, 1, 1);

    const result = await triageComplaint(parsed, {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({ exists: true, isPrivate: false })),
    });

    expect(result.diagnosisCode).toBe('USERNAME_MISMATCH');
  });

  test('returns ACCOUNT_PRIVATE when RapidAPI marks account private', async () => {
    const parsed = makeParsed();
    setupRepoMocks(baseUser);

    const result = await triageComplaint(parsed, {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({ exists: true, isPrivate: true })),
    });

    expect(result.diagnosisCode).toBe('ACCOUNT_PRIVATE');
  });

  test('returns NO_CONTENT when rapid profile has zero posts', async () => {
    const parsed = makeParsed();
    setupRepoMocks(baseUser, 1, 1);

    const result = await triageComplaint(parsed, {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({
        exists: true,
        isPrivate: false,
        posts: 0,
        hasProfilePic: true,
        recentActivityScore: 3,
      })),
    });

    expect(result.diagnosisCode).toBe('NO_CONTENT');
    expect(result.diagnoses).toEqual(expect.arrayContaining(['NO_CONTENT', 'LOW_TRUST']));
  });

  test('returns SYNC_PENDING when recent audit is empty but historical audit exists', async () => {
    const parsed = makeParsed();
    setupRepoMocks(baseUser, 0, 0, 5, 3);

    const result = await triageComplaint(parsed, {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({ exists: true, isPrivate: false, posts: 20, hasProfilePic: true, recentActivityScore: 80 })),
    });

    expect(result.diagnosisCode).toBe('SYNC_PENDING');
    expect(result.nextActions[0].toLowerCase()).toContain('riwayat audit');
  });

  test('returns NOT_EXECUTED when both recent and historical audit are empty', async () => {
    const parsed = makeParsed();
    setupRepoMocks(baseUser, 0, 0, 0, 0);

    const result = await triageComplaint(parsed, {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({ exists: true, isPrivate: false })),
    });

    expect(result.diagnosisCode).toBe('NOT_EXECUTED');
    expect(result.nextActions[0].toLowerCase()).toContain('data historis');
  });

  test('handles RAPIDAPI_UNAVAILABLE with fallback guidance', async () => {
    const parsed = makeParsed();
    setupRepoMocks(baseUser);

    const rapidError = new Error('unavailable');
    rapidError.code = 'RAPIDAPI_UNAVAILABLE';

    const result = await triageComplaint(parsed, {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => {
        throw rapidError;
      }),
    });

    expect(result.diagnosisCode).toBe('SYNC_PENDING');
    expect(result.operatorResponse.toLowerCase()).toContain('screenshot');
  });
});
