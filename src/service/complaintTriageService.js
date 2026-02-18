import { buildAdminSummary, buildOperatorResponse } from './complaintResponseTemplates.js';

const SYNC_WINDOW_MS = 30 * 60 * 1000;

function normalizeHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function hasCommentIssue(issues = []) {
  return issues.some((issue) => /komentar|comment/i.test(issue || ''));
}

function assessLowTrust(profile) {
  if (!profile) return false;
  const lowPosts = profile.posts === 0 || profile.posts === null;
  const lowScore = profile.recentActivityScore !== null && profile.recentActivityScore < 10;
  const noProfilePic = profile.hasProfilePic === false;
  return lowPosts || lowScore || noProfilePic;
}

function createDefaultResult() {
  return {
    status: 'NEED_MORE_DATA',
    diagnosisCode: 'UNKNOWN',
    confidence: 0.3,
    evidence: { internal: {}, rapidapi: {} },
    nextActions: ['Kirim screenshot profil terbaru dan bukti aksi terakhir.'],
    operatorResponse: '',
    adminSummary: '',
  };
}

async function getUserByNrp(db, nrp) {
  const sql = `
    SELECT user_id, nama, insta, tiktok, updated_at
    FROM "user"
    WHERE user_id = $1
    LIMIT 1
  `;
  const result = await db.query(sql, [nrp]);
  return result.rows?.[0] || null;
}

async function getAuditCounts(db, platform, username, windowStart, windowEnd) {
  const normalized = normalizeHandle(username);
  if (!normalized) return 0;

  const queryMap = {
    instagram: `
      SELECT COUNT(DISTINCT p.shortcode) AS total
      FROM insta_like l
      JOIN insta_post p ON p.shortcode = l.shortcode
      JOIN LATERAL (
        SELECT lower(replace(trim(COALESCE(elem->>'username', trim(both '"' FROM elem::text))), '@', '')) AS username
        FROM jsonb_array_elements(COALESCE(l.likes, '[]'::jsonb)) AS elem
      ) AS liked ON liked.username = $1
      WHERE p.created_at BETWEEN $2::timestamptz AND $3::timestamptz
    `,
    tiktok: `
      SELECT COUNT(DISTINCT c.video_id) AS total
      FROM tiktok_comment c
      JOIN tiktok_post p ON p.video_id = c.video_id
      JOIN LATERAL (
        SELECT lower(replace(trim(raw_username), '@', '')) AS username
        FROM jsonb_array_elements_text(COALESCE(c.comments, '[]'::jsonb)) AS raw(raw_username)
      ) AS commenter ON commenter.username = $1
      WHERE p.created_at BETWEEN $2::timestamptz AND $3::timestamptz
    `,
  };

  const sql = queryMap[platform];
  if (!sql) return 0;

  const result = await db.query(sql, [normalized, windowStart.toISOString(), windowEnd.toISOString()]);
  const total = Number(result.rows?.[0]?.total || 0);
  return Number.isFinite(total) ? total : 0;
}

export async function triageComplaint(parsed, { db, now = new Date(), rapidApi }) {
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
    user = await getUserByNrp(db, reporter.nrp);
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
  try {
    auditLikeCount = reporter.igUsername
      ? await getAuditCounts(db, 'instagram', reporter.igUsername, windowStart, windowEnd)
      : 0;
    auditCommentCount = reporter.tiktokUsername
      ? await getAuditCounts(db, 'tiktok', reporter.tiktokUsername, windowStart, windowEnd)
      : 0;
  } catch (err) {
    result.evidence.internal.auditTableStatus = 'audit table not found';
  }

  result.evidence.internal.auditLikeCount = auditLikeCount;
  result.evidence.internal.auditCommentCount = auditCommentCount;

  const mismatchIg = reporter.igUsername && normalizeHandle(reporter.igUsername) !== normalizeHandle(usernameDb.instagram);
  const mismatchTiktok = reporter.tiktokUsername && normalizeHandle(reporter.tiktokUsername) !== normalizeHandle(usernameDb.tiktok);
  const hasMismatch = Boolean(mismatchIg || mismatchTiktok);

  const shouldCallRapid =
    hasMismatch ||
    (auditLikeCount === 0 && auditCommentCount === 0) ||
    hasCommentIssue(parsed?.issues || []);

  const rapidEvidence = {};
  if (shouldCallRapid && typeof rapidApi === 'function') {
    try {
      if (reporter.igUsername) {
        rapidEvidence.instagram = await rapidApi({
          platform: 'instagram',
          username: reporter.igUsername,
        });
      }
      if (reporter.tiktokUsername) {
        rapidEvidence.tiktok = await rapidApi({
          platform: 'tiktok',
          username: reporter.tiktokUsername,
        });
      }
    } catch (err) {
      if (err?.code === 'RAPIDAPI_UNAVAILABLE') {
        result.diagnosisCode = 'SYNC_PENDING';
        result.confidence = 0.45;
        result.nextActions = [
          'RapidAPI sedang tidak tersedia. Mohon kirim screenshot profil + bukti aksi terbaru.',
          'Ulangi like/komentar sekali lagi, lalu cek ulang setelah 30 menit.',
        ];
        result.evidence.rapidapi.providerError = {
          status: err.status || 503,
          message: err.message,
        };
        result.operatorResponse = buildOperatorResponse(result, parsed);
        result.adminSummary = buildAdminSummary(result, parsed);
        return result;
      }
    }
  }

  result.evidence.rapidapi = rapidEvidence;

  if (hasMismatch) {
    result.status = 'NEED_MORE_DATA';
    result.diagnosisCode = 'USERNAME_MISMATCH';
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
      result.confidence = 0.9;
      result.nextActions = [
        'Ubah akun ke public sementara proses verifikasi.',
        'Ulangi aksi dan tunggu sinkronisasi 30 menit.',
      ];
    } else if (!user) {
      result.status = 'NEED_MORE_DATA';
      result.diagnosisCode = 'EXECUTED_BEFORE_REGISTERED';
      result.confidence = 0.88;
      result.nextActions = ['Daftarkan/update akun di CICERO lalu ulangi aktivitas pada konten target.'];
    } else if (auditLikeCount === 0 && auditCommentCount === 0) {
      result.status = 'NEED_MORE_DATA';
      result.diagnosisCode = 'NOT_EXECUTED';
      result.confidence = 0.75;
      result.nextActions = [
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
    } else if (profiles.some((profile) => assessLowTrust(profile))) {
      result.status = 'NEED_MORE_DATA';
      result.diagnosisCode = 'LOW_TRUST';
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
