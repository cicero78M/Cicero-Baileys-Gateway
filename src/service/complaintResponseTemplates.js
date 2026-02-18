function lowActivityTemplate(platformLabel) {
  return [
    `Hasil verifikasi ${platformLabel}: akun terdeteksi tetapi aktivitas publik masih rendah (indikasi metrik <10, postingan minim, atau profil belum lengkap).`,
    'Langkah cepat:',
    '1) Pastikan username di komplain sama persis dengan akun yang dipakai saat tugas.',
    '2) Lengkapi profil dan tingkatkan aktivitas wajar sampai metrik stabil (minimal 10).',
    '3) Ulangi aksi like/komentar di konten resmi, tunggu sinkronisasi ±30-60 menit.',
    '4) Kirim screenshot profil + bukti aksi terbaru jika masih belum terdata.',
  ].join('\n');
}

function activeValidTemplate(platformLabel) {
  return [
    `Hasil verifikasi ${platformLabel}: akun aktif dan metrik publik valid (>=10).`,
    'Langkah cepat:',
    '1) Pastikan aksi dilakukan dari akun yang tercatat di CICERO.',
    '2) Refresh menu absensi sesuai satker/periode.',
    '3) Jika belum masuk setelah 30-60 menit, kirim link konten + screenshot bukti aksi.',
  ].join('\n');
}

function normalizeHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function getMatchStatus(reportedUsername, dbUsername) {
  if (!reportedUsername) return '-';
  if (!dbUsername) return 'tidak cocok';
  return normalizeHandle(reportedUsername) === normalizeHandle(dbUsername) ? 'cocok' : 'tidak cocok';
}

function formatVerificationBlock(parsed, triageResult) {
  const evidenceInternal = triageResult?.evidence?.internal;
  const reporter = parsed?.reporter || {};

  if (!evidenceInternal || !evidenceInternal.usernameDb) {
    return ['• Hasil verifikasi:', '  - data audit belum tersedia.'];
  }

  const usernameDb = evidenceInternal.usernameDb || {};
  return [
    '• Hasil verifikasi:',
    `  - IG laporan: ${reporter.igUsername || '-'} | IG CICERO: ${usernameDb.instagram || '-'} | Status: ${getMatchStatus(reporter.igUsername, usernameDb.instagram)}`,
    `  - TikTok laporan: ${reporter.tiktokUsername || '-'} | TikTok CICERO: ${usernameDb.tiktok || '-'} | Status: ${getMatchStatus(reporter.tiktokUsername, usernameDb.tiktok)}`,
  ];
}

function formatAuditBlock(triageResult) {
  const evidenceInternal = triageResult?.evidence?.internal;
  if (!evidenceInternal) {
    return ['• Ringkasan audit:', '  - data audit belum tersedia.'];
  }

  const hasWindow = Boolean(evidenceInternal.auditWindowStart && evidenceInternal.auditWindowEnd);
  const hasAuditCounts =
    evidenceInternal.auditLikeCount !== undefined ||
    evidenceInternal.auditCommentCount !== undefined ||
    evidenceInternal.historicalAuditLikeCount !== undefined ||
    evidenceInternal.historicalAuditCommentCount !== undefined;

  if (!hasWindow && !hasAuditCounts) {
    return ['• Ringkasan audit:', '  - data audit belum tersedia.'];
  }

  return [
    '• Ringkasan audit:',
    `  - Window sinkronisasi: ${evidenceInternal.auditWindowStart || '-'} s/d ${evidenceInternal.auditWindowEnd || '-'}`,
    `  - Window terbaru: like ${evidenceInternal.auditLikeCount ?? '-'} | komentar ${evidenceInternal.auditCommentCount ?? '-'}`,
    `  - Historis: like ${evidenceInternal.historicalAuditLikeCount ?? '-'} | komentar ${evidenceInternal.historicalAuditCommentCount ?? '-'}`,
  ];
}

function formatNextActions(nextActions = []) {
  if (!nextActions.length) return ['• Next actions: -'];
  return ['• Next actions:', ...nextActions.map((item, index) => `  ${index + 1}) ${item}`)];
}

export function buildOperatorResponse(triageResult, parsed) {
  const platformHints = [];
  if (parsed?.reporter?.igUsername) platformHints.push('Instagram');
  if (parsed?.reporter?.tiktokUsername) platformHints.push('TikTok');
  const platformLabel = platformHints.length ? platformHints.join(' & ') : 'akun sosial';

  if (triageResult.diagnosisCode === 'LOW_TRUST') {
    return lowActivityTemplate(platformLabel);
  }

  if (triageResult.diagnosisCode === 'OK_ACTIVE_VALID') {
    return activeValidTemplate(platformLabel);
  }

  return [
    `Ringkasan pengecekan: ${triageResult.diagnosisCode.replace(/_/g, ' ').toLowerCase()}.`,
    ...formatVerificationBlock(parsed, triageResult),
    ...formatAuditBlock(triageResult),
    ...formatNextActions(triageResult.nextActions || []),
  ].join('\n');
}

export function buildAdminSummary(triageResult, parsed) {
  const evidenceInternal = triageResult?.evidence?.internal;
  const usernameDb = evidenceInternal?.usernameDb || {};

  return [
    '📌 *Complaint Triage Summary*',
    `NRP: ${parsed?.reporter?.nrp || '-'}`,
    `Nama: ${parsed?.reporter?.nama || '-'}`,
    `IG: ${parsed?.reporter?.igUsername || '-'}`,
    `TikTok: ${parsed?.reporter?.tiktokUsername || '-'}`,
    `IG CICERO: ${usernameDb.instagram || '-'}`,
    `IG Match: ${getMatchStatus(parsed?.reporter?.igUsername, usernameDb.instagram)}`,
    `TikTok CICERO: ${usernameDb.tiktok || '-'}`,
    `TikTok Match: ${getMatchStatus(parsed?.reporter?.tiktokUsername, usernameDb.tiktok)}`,
    `Window Sync: ${evidenceInternal?.auditWindowStart || '-'} s/d ${evidenceInternal?.auditWindowEnd || '-'}`,
    `Audit Window (L/C): ${evidenceInternal?.auditLikeCount ?? '-'} / ${evidenceInternal?.auditCommentCount ?? '-'}`,
    `Audit Historis (L/C): ${evidenceInternal?.historicalAuditLikeCount ?? '-'} / ${evidenceInternal?.historicalAuditCommentCount ?? '-'}`,
    `Diagnosis: ${triageResult.diagnosisCode}`,
    `Status: ${triageResult.status}`,
    `Confidence: ${triageResult.confidence}`,
    `Aksi: ${(triageResult.nextActions || []).join(' | ') || '-'}`,
  ].join('\n');
}
