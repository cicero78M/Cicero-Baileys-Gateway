/**
 * T012 — complaintTriageProfileCodes.test.js
 * Tests: ACCOUNT_PRIVATE, NO_PROFILE_PHOTO, NO_CONTENT+LOW_TRUST, EXTERNAL_NA, profileLinks
 */
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
      igUsername: 'tester_ig',
      tiktokUsername: 'tester_tiktok',
      ...reporterOverride,
    },
    issues: ['sudah like belum terdata'],
    ...rest,
  };
}

const baseUser = { user_id: '75020201', insta: 'tester_ig', tiktok: 'tester_tiktok', updated_at: new Date().toISOString() };

/** Configure repo mocks: auditCount = recent, allTimeCount separately */
function setupRepoMocks(userRow, recentCount = 1, allTimeCount = 1) {
  mockGetUserByNrp.mockResolvedValue(userRow || null);
  mockGetAuditCounts.mockResolvedValue({ recentCount, allTimeCount });
}

describe('complaintTriageProfileCodes', () => {
  // (a) isPrivate: true → ACCOUNT_PRIVATE in diagnoses
  test('(a) isPrivate:true → ACCOUNT_PRIVATE in diagnosisCode and diagnoses', async () => {
    setupRepoMocks(baseUser, 1, 1);
    const result = await triageComplaint(makeParsed(), {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({ exists: true, isPrivate: true, hasProfilePic: true, posts: 5 })),
    });

    expect(result.diagnosisCode).toBe('ACCOUNT_PRIVATE');
    expect(result.diagnoses).toContain('ACCOUNT_PRIVATE');
  });

  // (b) hasProfilePic: false → NO_PROFILE_PHOTO in diagnoses
  test('(b) hasProfilePic:false → NO_PROFILE_PHOTO in diagnosisCode and diagnoses', async () => {
    setupRepoMocks(baseUser, 1, 1);
    const result = await triageComplaint(makeParsed(), {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({ exists: true, isPrivate: false, hasProfilePic: false, posts: 5 })),
    });

    expect(result.diagnosisCode).toBe('NO_PROFILE_PHOTO');
    expect(result.diagnoses).toContain('NO_PROFILE_PHOTO');
  });

  // (c) posts: 0 → NO_CONTENT AND LOW_TRUST both in diagnoses
  test('(c) posts:0 → NO_CONTENT AND LOW_TRUST both present in diagnoses', async () => {
    setupRepoMocks(baseUser, 1, 1);
    const result = await triageComplaint(makeParsed(), {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({ exists: true, isPrivate: false, hasProfilePic: true, posts: 0 })),
    });

    expect(result.diagnosisCode).toBe('NO_CONTENT');
    expect(result.diagnoses).toContain('NO_CONTENT');
    expect(result.diagnoses).toContain('LOW_TRUST');
  });

  // (d) RapidAPI throws network error → EXTERNAL_NA flag set, triage still completes with internal data
  test('(d) RapidAPI network error → EXTERNAL_NA in diagnoses, triage finishes', async () => {
    setupRepoMocks(baseUser, 1, 1);
    const networkErr = new Error('Network timeout');

    const result = await triageComplaint(makeParsed(), {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => { throw networkErr; }),
    });

    expect(result.diagnoses).toContain('EXTERNAL_NA');
    expect(result.diagnosisCode).not.toBe('UNKNOWN');
    expect(result.evidence.rapidapi.providerError).toBeDefined();
    // Triage must have reached a verdict using internal data
    expect(typeof result.operatorResponse).toBe('string');
    expect(result.operatorResponse.length).toBeGreaterThan(0);
  });

  // (e) profileLinks contains correct URLs
  test('(e) evidence.profileLinks contains correct Instagram and TikTok URLs', async () => {
    setupRepoMocks(baseUser, 1, 1);
    const result = await triageComplaint(makeParsed(), {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({ exists: true, isPrivate: false, hasProfilePic: true, posts: 5 })),
    });

    expect(result.evidence.profileLinks.instagram).toBe('https://instagram.com/tester_ig');
    expect(result.evidence.profileLinks.tiktok).toBe('https://tiktok.com/@tester_tiktok');
  });

  // Verify profileLinks also present when account is private
  test('profileLinks present even when ACCOUNT_PRIVATE', async () => {
    setupRepoMocks(baseUser, 1, 1);
    const result = await triageComplaint(makeParsed(), {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({ exists: true, isPrivate: true })),
    });

    expect(result.evidence.profileLinks.instagram).toBe('https://instagram.com/tester_ig');
    expect(result.evidence.profileLinks.tiktok).toBe('https://tiktok.com/@tester_tiktok');
  });

  // buildProfileLink helper (T011)
  test('buildProfileLink returns correct URLs for instagram and tiktok', async () => {
    const { buildProfileLink } = await import('../src/service/complaintResponseTemplates.js');
    expect(buildProfileLink('instagram', 'myuser')).toBe('https://instagram.com/myuser');
    expect(buildProfileLink('instagram', '@myuser')).toBe('https://instagram.com/myuser');
    expect(buildProfileLink('tiktok', 'myuser')).toBe('https://tiktok.com/@myuser');
    expect(buildProfileLink('tiktok', '@myuser')).toBe('https://tiktok.com/@myuser');
    expect(buildProfileLink('other', 'x')).toBe('');
    expect(buildProfileLink('instagram', '')).toBe('');
  });

  // T011: buildOperatorResponse includes profileLink in ACCOUNT_PRIVATE branch
  test('buildOperatorResponse ACCOUNT_PRIVATE branch includes profile links', async () => {
    const { buildOperatorResponse } = await import('../src/service/complaintResponseTemplates.js');
    const triageResult = {
      diagnosisCode: 'ACCOUNT_PRIVATE',
      diagnoses: ['ACCOUNT_PRIVATE'],
      status: 'NEED_MORE_DATA',
      confidence: 0.9,
      nextActions: [],
      evidence: {
        profileLinks: { instagram: 'https://instagram.com/user1' },
        internal: {},
        rapidapi: {},
      },
    };
    const response = buildOperatorResponse(triageResult, { reporter: { igUsername: 'user1' } });
    expect(response).toContain('private');
    expect(response).toContain('https://instagram.com/user1');
  });

  // T011: EXTERNAL_NA additive note in buildOperatorResponse
  test('buildOperatorResponse appends EXTERNAL_NA note when diagnoses contains EXTERNAL_NA', async () => {
    const { buildOperatorResponse } = await import('../src/service/complaintResponseTemplates.js');
    const triageResult = {
      diagnosisCode: 'NOT_EXECUTED',
      diagnoses: ['EXTERNAL_NA'],
      status: 'NEED_MORE_DATA',
      confidence: 0.6,
      nextActions: ['Ulangi aksi.'],
      evidence: { profileLinks: {}, internal: {}, rapidapi: {} },
    };
    const response = buildOperatorResponse(triageResult, { reporter: {} });
    expect(response).toContain('verifikasi eksternal');
    expect(response).toContain('tidak tersedia');
  });

  // ── T022 additions ────────────────────────────────────────────────────────

  // (a) allTimeCount > 0 → ALREADY_PARTICIPATED in diagnoses + latestPostUrl set
  test('T022(a) allTimeCount > 0 → ALREADY_PARTICIPATED in diagnoses', async () => {
    const mockGetLatestPost = (await import('../src/repository/complaintRepository.js')).getLatestPost;
    mockGetLatestPost.mockResolvedValue({ shortcode: 'ABC123' });
    setupRepoMocks(baseUser, 0, 3); // recentCount=0, allTimeCount=3
    const result = await triageComplaint(makeParsed(), {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({ exists: true, isPrivate: false, hasProfilePic: true, posts: 5 })),
      clientId: 'client1',
    });
    expect(result.diagnoses).toContain('ALREADY_PARTICIPATED');
    expect(result.evidence.latestPostUrl).toBe('https://instagram.com/p/ABC123');
  });

  // (b) allTimeCount > 0 but no rows in insta_post → latestPostUrl === null
  test('T022(b) allTimeCount > 0, no post rows → latestPostUrl === null', async () => {
    const mockGetLatestPost = (await import('../src/repository/complaintRepository.js')).getLatestPost;
    mockGetLatestPost.mockResolvedValue(null);
    setupRepoMocks(baseUser, 0, 2);
    const result = await triageComplaint(makeParsed(), {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => ({ exists: true, isPrivate: false, hasProfilePic: true, posts: 5 })),
      clientId: 'client1',
    });
    expect(result.diagnoses).toContain('ALREADY_PARTICIPATED');
    expect(result.evidence.latestPostUrl).toBeNull();
  });

  // (c) USERNAME_MISMATCH → rapidApi called for both usernames, moreRelevant set
  test('T022(c) USERNAME_MISMATCH → rapidApi called twice with both usernames, moreRelevant determined', async () => {
    setupRepoMocks(
      { user_id: '75020201', insta: 'other_ig', tiktok: 'tester_tiktok', updated_at: new Date().toISOString() },
      1, 1,
    );
    const rapidCalls = [];
    const rapidApi = jest.fn(async ({ platform, username }) => {
      rapidCalls.push({ platform, username });
      if (username === 'tester_ig') return { exists: true, isPrivate: false, followers_count: 500, media_count: 10 };
      if (username === 'other_ig') return { exists: true, isPrivate: false, followers_count: 100, media_count: 5 };
      return { exists: true, isPrivate: false, followers_count: 0, media_count: 0 };
    });
    const result = await triageComplaint(makeParsed(), {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi,
    });
    expect(result.diagnosisCode).toBe('USERNAME_MISMATCH');
    expect(result.evidence.mismatch).toBeDefined();
    expect(result.evidence.mismatch.moreRelevant).toBeDefined();
    // Both IG usernames fetched
    const igCalls = rapidCalls.filter((c) => c.platform === 'instagram');
    expect(igCalls.length).toBeGreaterThanOrEqual(2);
    const calledUsernames = igCalls.map((c) => c.username);
    expect(calledUsernames).toContain('tester_ig');
    expect(calledUsernames).toContain('other_ig');
  });

  // (d) Both rapidApi calls fail → mismatch evidence has null profiles, triage still completes
  test('T022(d) Both rapidApi calls fail → triage finishes, mismatch evidence present', async () => {
    setupRepoMocks(
      { user_id: '75020201', insta: 'other_ig', tiktok: 'tester_tiktok', updated_at: new Date().toISOString() },
      1, 1,
    );
    const result = await triageComplaint(makeParsed(), {
      now: new Date('2026-02-01T10:00:00Z'),
      rapidApi: jest.fn(async () => { throw new Error('timeout'); }),
    });
    expect(result.diagnosisCode).toBe('USERNAME_MISMATCH');
    expect(result.evidence.mismatch).toBeDefined();
    // profiles are null since safeFetch swallows errors
    expect(result.evidence.mismatch.reportedProfile).toBeNull();
    expect(result.evidence.mismatch.dbProfile).toBeNull();
  });

  // (e) USERNAME_MISMATCH + profile condition active → rapidApi called exactly twice for IG (no 3rd call, H1)
  test('T022(e) USERNAME_MISMATCH + profile condition → rapidApi called exactly 2 times total for mismatch platform (H1)', async () => {
    setupRepoMocks(
      { user_id: '75020201', insta: 'other_ig', tiktok: 'tester_tiktok', updated_at: new Date().toISOString() },
      1, 1,
    );
    const rapidApi = jest.fn(async ({ platform, username }) => {
      if (platform === 'instagram' && username === 'tester_ig')
        return { exists: true, isPrivate: true, followers_count: 50, media_count: 2 };
      if (platform === 'instagram' && username === 'other_ig')
        return { exists: true, isPrivate: false, followers_count: 100, media_count: 5 };
      return null;
    });
    const result = await triageComplaint(
      makeParsed({ reporter: { igUsername: 'tester_ig', tiktokUsername: null } }),
      { now: new Date('2026-02-01T10:00:00Z'), rapidApi },
    );
    expect(result.diagnosisCode).toBe('USERNAME_MISMATCH');
    // COUNT: IG calls for mismatch dual-fetch only (no 3rd call for same username per H1)
    const igCalls = rapidApi.mock.calls.filter(([args]) => args.platform === 'instagram');
    const uniqueUsernames = new Set(igCalls.map(([args]) => args.username));
    // Must have called for both 'tester_ig' AND 'other_ig', but 'tester_ig' only ONCE
    expect(uniqueUsernames.has('tester_ig')).toBe(true);
    expect(uniqueUsernames.has('other_ig')).toBe(true);
    const testerIgCalls = igCalls.filter(([args]) => args.username === 'tester_ig');
    expect(testerIgCalls.length).toBe(1); // H1: no extra call for same username
  });

  // ── T026 RAPIDAPI_TIMEOUT_MS ─────────────────────────────────────────────

  // T026(a): rapidApi responds within timeout → triage completes normally
  test('T026(a) rapidApi responds within timeout → triage completes normally (no EXTERNAL_NA)', async () => {
    const savedTimeout = process.env.RAPIDAPI_TIMEOUT_MS;
    process.env.RAPIDAPI_TIMEOUT_MS = '200'; // 200 ms limit for this test
    try {
      setupRepoMocks(baseUser, 1, 1);
      // API responds after 50 ms — well within 200 ms limit
      const rapidApi = jest.fn(
        () => new Promise((resolve) => setTimeout(() => resolve({ exists: true, isPrivate: false, hasProfilePic: true, posts: 5 }), 50)),
      );
      const result = await triageComplaint(makeParsed(), {
        now: new Date('2026-02-01T10:00:00Z'),
        rapidApi,
      });
      // Should complete without EXTERNAL_NA (API responded in time)
      expect(result.diagnoses).not.toContain('EXTERNAL_NA');
    } finally {
      if (savedTimeout === undefined) delete process.env.RAPIDAPI_TIMEOUT_MS;
      else process.env.RAPIDAPI_TIMEOUT_MS = savedTimeout;
    }
  }, 5000);

  // T026(b): rapidApi exceeds timeout → EXTERNAL_NA set, triage still finishes
  test('T026(b) rapidApi exceeds timeout → EXTERNAL_NA flag set, triage still finishes', async () => {
    const savedTimeout = process.env.RAPIDAPI_TIMEOUT_MS;
    process.env.RAPIDAPI_TIMEOUT_MS = '100'; // very short, 100 ms
    try {
      setupRepoMocks(baseUser, 1, 1);
      // API responds after 300 ms — exceeds 100 ms limit
      const rapidApi = jest.fn(
        () => new Promise((resolve) => setTimeout(() => resolve({ exists: true, isPrivate: false, hasProfilePic: true, posts: 5 }), 300)),
      );
      const result = await triageComplaint(makeParsed(), {
        now: new Date('2026-02-01T10:00:00Z'),
        rapidApi,
      });
      // EXTERNAL_NA additive flag must be present
      expect(result.diagnoses).toContain('EXTERNAL_NA');
      // Triage must finish (result.status defined, not thrown)
      expect(result.status).toBeDefined();
    } finally {
      if (savedTimeout === undefined) delete process.env.RAPIDAPI_TIMEOUT_MS;
      else process.env.RAPIDAPI_TIMEOUT_MS = savedTimeout;
    }
  }, 5000);
});
