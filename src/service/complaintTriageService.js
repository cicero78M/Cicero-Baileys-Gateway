import { buildAdminSummary, buildOperatorResponse } from './complaintResponseTemplates.js';
import {
  getUserByNrp,
  getAuditCounts as getAuditCountsRepo,
  getLatestPost,
} from '../repository/complaintRepository.js';

const SYNC_WINDOW_MS = 30 * 60 * 1000;

/**
 * Wrap a promise with a timeout. Rejects with a timeout error after `ms` milliseconds.
 * @param {Promise<any>} promise
 * @param {number} ms
 * @returns {Promise<any>}
 */
function withTimeout(promise, ms) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`RapidAPI call timed out after ${ms}ms`);
      err.code = 'RAPIDAPI_TIMEOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function getRapidApiTimeoutMs() {
  const val = Number(process.env.RAPIDAPI_TIMEOUT_MS);
  return Number.isFinite(val) && val > 0 ? val : 5000;
}

function normalizeHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function hasCommentIssue(issues = []) {
  return issues.some((issue) => /komentar|comment/i.test(issue || ''));
}

/**
 * Assess the profile-level condition codes for a single social profile.
 * Returns an ordered priority list: ACCOUNT_PRIVATE > NO_PROFILE_PHOTO > NO_CONTENT+LOW_TRUST.
 * @param {object|null} profile
 * @returns {string[]}
 */
export function assessProfileConditions(profile) {
  if (!profile) return [];
  if (profile.isPrivate === true) return ['ACCOUNT_PRIVATE'];
  if (profile.hasProfilePic === false) return ['NO_PROFILE_PHOTO'];
  if (profile.posts === 0) return ['NO_CONTENT', 'LOW_TRUST'];
  return [];
}

function createDefaultResult() {
  return {
    status: 'NEED_MORE_DATA',
    diagnosisCode: 'UNKNOWN',
    diagnoses: [],
    confidence: 0.3,
    evidence: { internal: {}, rapidapi: {}, profileLinks: {} },
    nextActions: ['Kirim screenshot profil terbaru dan bukti aksi terakhir.'],
    operatorResponse: '',
    adminSummary: '',
  };
}

export async function triageComplaint(parsed, { db, now = new Date(), rapidApi, clientId = null }) {
  const result = createDefaultResult();
  const reporter = parsed?.reporter || {};

  if (!reporter.nrp) {
    result.diagnosisCode = 'UNKNOWN';
    result.nextActions = ['Lengkapi NRP/NIP pada format Pesan Komplain.'];
    result.operatorResponse = buildOperatorResponse(result, parsed);
    result.adminSummary = buildAdminSummary(result, parsed);
    return result;
  }

  let user;
  try {
    user = await getUserByNrp(reporter.nrp, db);
  } catch (err) {
    result.status = 'ERROR';
    result.diagnosisCode = 'UNKNOWN';
    result.evidence.internal.auditTableStatus = 'audit table not found';
    result.nextActions = ['Cek koneksi/query audit internal sebelum memproses komplain.'];
    result.operatorResponse = buildOperatorResponse(result, parsed);
    result.adminSummary = buildAdminSummary(result, parsed);
    return result;
  }

  const usernameDb = {
    instagram: user?.insta || '',
    tiktok: user?.tiktok || '',
  };

  result.evidence.internal.usernameDb = usernameDb;
  result.evidence.internal.lastUsernameUpdateAt = user?.updated_at || null;

  const windowEnd = now;
  const windowStart = new Date(now.getTime() - SYNC_WINDOW_MS);
  result.evidence.internal.auditWindowStart = windowStart.toISOString();
  result.evidence.internal.auditWindowEnd = windowEnd.toISOString();

  let auditLikeCount = 0;
  let auditCommentCount = 0;
  let historicalAuditLikeCount = 0;
  let historicalAuditCommentCount = 0;
  try {
    const igAudit = reporter.igUsername
      ? await getAuditCountsRepo(reporter.igUsername, 'instagram', { windowStart, windowEnd }, db)
      : { recentCount: 0, allTimeCount: 0 };
    const tiktokAudit = reporter.tiktokUsername
      ? await getAuditCountsRepo(reporter.tiktokUsername, 'tiktok', { windowStart, windowEnd }, db)
      : { recentCount: 0, allTimeCount: 0 };
    auditLikeCount = igAudit.recentCount;
    auditCommentCount = tiktokAudit.recentCount;
    historicalAuditLikeCount = igAudit.allTimeCount;
    historicalAuditCommentCount = tiktokAudit.allTimeCount;
  } catch (err) {
    result.evidence.internal.auditTableStatus = 'audit table not found';
  }

  result.evidence.internal.auditLikeCount = auditLikeCount;
  result.evidence.internal.auditCommentCount = auditCommentCount;
  result.evidence.internal.historicalAuditLikeCount = historicalAuditLikeCount;
  result.evidence.internal.historicalAuditCommentCount = historicalAuditCommentCount;

  const noRecentAuditData = auditLikeCount === 0 && auditCommentCount === 0;
  const hasHistoricalAuditData = historicalAuditLikeCount > 0 || historicalAuditCommentCount > 0;

  // T016: ALREADY_PARTICIPATED — user has prior audit history
  if (hasHistoricalAuditData) {
    result.diagnoses.push('ALREADY_PARTICIPATED');
    // Fetch latest post URL for the platform with historical data
    const alreadyPlatform = historicalAuditLikeCount > 0 ? 'instagram' : 'tiktok';
    let latestPostUrl = null;
    if (clientId) {
      try {
        const latestPost = await getLatestPost(clientId, alreadyPlatform, db);
        if (latestPost?.shortcode) {
          latestPostUrl = `https://instagram.com/p/${latestPost.shortcode}`;
        } else if (latestPost?.videoId) {
          latestPostUrl = `https://tiktok.com/video/${latestPost.videoId}`;
        }
      } catch {
        /* ignore: latestPostUrl stays null */
      }
    }
    result.evidence.latestPostUrl = latestPostUrl;
  }

  const mismatchIg = reporter.igUsername && normalizeHandle(reporter.igUsername) !== normalizeHandle(usernameDb.instagram);
  const mismatchTiktok = reporter.tiktokUsername && normalizeHandle(reporter.tiktokUsername) !== normalizeHandle(usernameDb.tiktok);
  const hasMismatch = Boolean(mismatchIg || mismatchTiktok);

  const shouldCallRapid =
    hasMismatch ||
    noRecentAuditData ||
    hasHistoricalAuditData ||
    hasCommentIssue(parsed?.issues || []);

  const rapidEvidence = {};
  let rapidProviderError = null;
  if (shouldCallRapid && typeof rapidApi === 'function') {
    try {
      if (hasMismatch) {
        // T015: dual-fetch reported + DB profiles in parallel (H1: no 3rd call)
        const mPlatform = mismatchIg ? 'instagram' : 'tiktok';
        const mReported = mismatchIg ? reporter.igUsername : reporter.tiktokUsername;
        const mDb = mismatchIg ? usernameDb.instagram : usernameDb.tiktok;

        const safeFetch = (platform, username) =>
          username
            ? withTimeout(rapidApi({ platform, username }), getRapidApiTimeoutMs()).catch(() => null)
            : Promise.resolve(null);

        const [reportedProfile, dbProfile] = await Promise.all([
          safeFetch(mPlatform, mReported),
          safeFetch(mPlatform, mDb),
        ]);

        // Store in rapidEvidence for profile-condition checks (H1: reuse, no re-fetch)
        if (mPlatform === 'instagram') rapidEvidence.instagram = reportedProfile;
        else rapidEvidence.tiktok = reportedProfile;

        // Compute relevance score: followers + media_count, penalty for private
        const relScore = (p) =>
          p ? ((p.followers_count || 0) + (p.media_count || 0)) * (p.isPrivate ? 0.5 : 1) : 0;
        const moreRelevant = relScore(reportedProfile) >= relScore(dbProfile) ? 'reported' : 'db';
        result.evidence.mismatch = { reportedProfile, dbProfile, moreRelevant };

        // Fetch non-mismatch platform if applicable
        if (mismatchIg && reporter.tiktokUsername) {
          rapidEvidence.tiktok = await withTimeout(rapidApi({ platform: 'tiktok', username: reporter.tiktokUsername }), getRapidApiTimeoutMs()).catch(() => null);
        } else if (!mismatchIg && reporter.igUsername) {
          rapidEvidence.instagram = await withTimeout(rapidApi({ platform: 'instagram', username: reporter.igUsername }), getRapidApiTimeoutMs()).catch(() => null);
        }
      } else {
        if (reporter.igUsername) {
          rapidEvidence.instagram = await withTimeout(
            rapidApi({ platform: 'instagram', username: reporter.igUsername }),
            getRapidApiTimeoutMs(),
          );
        }
        if (reporter.tiktokUsername) {
          rapidEvidence.tiktok = await withTimeout(
            rapidApi({ platform: 'tiktok', username: reporter.tiktokUsername }),
            getRapidApiTimeoutMs(),
          );
        }
      }
    } catch (err) {
      // Mark EXTERNAL_NA as additive flag — main diagnosis still proceeds with internal data
      result.diagnoses.push('EXTERNAL_NA');
      rapidProviderError = { status: err.status || 503, message: err.message };
      if (err?.code === 'RAPIDAPI_UNAVAILABLE') {
        result.diagnosisCode = 'SYNC_PENDING';
        result.confidence = 0.45;
        result.nextActions = [
          'RapidAPI sedang tidak tersedia. Mohon kirim screenshot profil + bukti aksi terbaru.',
          'Ulangi like/komentar sekali lagi, lalu cek ulang setelah 30 menit.',
        ];
        result.evidence.rapidapi = { providerError: rapidProviderError };
        result.operatorResponse = buildOperatorResponse(result, parsed);
        result.adminSummary = buildAdminSummary(result, parsed);
        return result;
      }
      // For other network errors: continue triage with internal data only
    }
  }

  result.evidence.rapidapi = rapidEvidence;
  if (rapidProviderError) {
    result.evidence.rapidapi.providerError = rapidProviderError;
  }

  // Populate profileLinks so templates/UI can render direct links
  if (reporter.igUsername) {
    result.evidence.profileLinks.instagram = `https://instagram.com/${reporter.igUsername}`;
  }
  if (reporter.tiktokUsername) {
    result.evidence.profileLinks.tiktok = `https://tiktok.com/@${reporter.tiktokUsername}`;
  }

  if (hasMismatch) {
    result.status = 'NEED_MORE_DATA';
    result.diagnosisCode = 'USERNAME_MISMATCH';
    result.diagnoses.push('USERNAME_MISMATCH');

    // H1: reuse reportedProfile from dual-fetch (no 3rd RapidAPI call)
    const mPlatform = mismatchIg ? 'instagram' : 'tiktok';
    const reportedProfileForAssess = result.evidence.mismatch?.reportedProfile
      ?? (mPlatform === 'instagram' ? rapidEvidence.instagram : rapidEvidence.tiktok);
    for (const code of assessProfileConditions(reportedProfileForAssess)) {
      result.diagnoses.push(code);
    }

    result.confidence = 0.92;
    result.nextActions = [
      'Samakan username di CICERO dengan username yang dipakai saat aksi.',
      'Kirim screenshot profil terbaru, lalu ulangi aksi like/komentar.',
    ];
  } else {
    const profiles = Object.values(rapidEvidence).filter(Boolean);
    const anyPrivate = profiles.some((profile) => profile.isPrivate === true);

    if (anyPrivate) {
      result.status = 'NEED_MORE_DATA';
      result.diagnosisCode = 'ACCOUNT_PRIVATE';
      result.diagnoses = ['ACCOUNT_PRIVATE'];
      result.confidence = 0.9;
      result.nextActions = [
        'Ubah akun ke public sementara proses verifikasi.',
        'Ulangi aksi dan tunggu sinkronisasi 30 menit.',
      ];
    } else if (profiles.some((p) => p.hasProfilePic === false)) {
      result.status = 'NEED_MORE_DATA';
      result.diagnosisCode = 'NO_PROFILE_PHOTO';
      result.diagnoses = ['NO_PROFILE_PHOTO'];
      result.confidence = 0.85;
      result.nextActions = [
        'Tambahkan foto profil agar akun terverifikasi.',
        'Ulangi aksi dan tunggu sinkronisasi 30 menit.',
      ];
    } else if (!user) {
      result.status = 'NEED_MORE_DATA';
      result.diagnosisCode = 'EXECUTED_BEFORE_REGISTERED';
      result.confidence = 0.88;
      result.nextActions = ['Daftarkan/update akun di CICERO lalu ulangi aktivitas pada konten target.'];
    } else if (noRecentAuditData && hasHistoricalAuditData) {
      result.status = 'NEED_MORE_DATA';
      result.diagnosisCode = 'SYNC_PENDING';
      result.confidence = 0.72;
      result.nextActions = [
        'Riwayat audit akun sudah ada, namun aksi terbaru belum terbaca di window sinkronisasi saat ini.',
        'Pastikan aksi dilakukan pada konten target resmi, lalu cek ulang setelah 30-60 menit.',
        'Jika tetap kosong, kirim screenshot profil + bukti aksi terbaru agar operator dapat validasi manual.',
      ];
    } else if (noRecentAuditData) {
      result.status = 'NEED_MORE_DATA';
      result.diagnosisCode = 'NOT_EXECUTED';
      result.confidence = 0.75;
      result.nextActions = [
        'Belum ditemukan jejak audit akun pada data historis maupun window sinkronisasi terbaru.',
        'Pastikan aksi dilakukan pada konten target resmi.',
        'Ulangi aksi dan cek ulang setelah window sinkronisasi.',
      ];
    } else if (hasCommentIssue(parsed?.issues || []) && auditLikeCount > 0 && auditCommentCount === 0) {
      result.status = 'NEED_MORE_DATA';
      result.diagnosisCode = 'COMMENT_SPAM';
      result.confidence = 0.7;
      result.nextActions = [
        'Komentar terdeteksi 0. Gunakan komentar teks normal (tanpa spam emoji/simbol).',
        'Ulangi komentar di konten target lalu tunggu sinkronisasi 30 menit.',
      ];
    } else if (profiles.some((p) => p.posts === 0)) {
      result.status = 'NEED_MORE_DATA';
      result.diagnosisCode = 'NO_CONTENT';
      result.diagnoses = ['NO_CONTENT', 'LOW_TRUST'];
      result.confidence = 0.8;
      result.nextActions = [
        'Aktivitas akun masih rendah, optimalkan profil/aktivitas dahulu.',
        'Kirim screenshot profil + bukti aksi terbaru untuk verifikasi ulang.',
      ];
    } else if (now.getTime() - windowStart.getTime() <= SYNC_WINDOW_MS) {
      result.status = 'NEED_MORE_DATA';
      result.diagnosisCode = 'SYNC_PENDING';
      result.confidence = 0.6;
      result.nextActions = ['Menunggu sinkronisasi ±30 menit sebelum validasi ulang.'];
    } else {
      result.status = 'OK';
      result.diagnosisCode = 'OK_ACTIVE_VALID';
      result.confidence = 0.85;
      result.nextActions = ['Data internal dan eksternal valid. Lanjutkan monitoring rutin.'];
    }
  }

  result.operatorResponse = buildOperatorResponse(result, parsed);
  result.adminSummary = buildAdminSummary(result, parsed);
  return result;
}
