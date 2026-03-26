const stripAt = (v) => String(v || '').replace(/^@/, '');

export function buildMismatchConfirmationDM(triageResult, parsed) {
  const reporter = parsed?.reporter || {};
  const mismatch = triageResult?.evidence?.mismatch || {};
  const usernameDb = triageResult?.evidence?.internal?.usernameDb || {};

  const igDb = usernameDb.instagram || '-';
  const tiktokDb = usernameDb.tiktok || '-';
  const igReported = reporter.igUsername || '-';
  const tiktokReported = reporter.tiktokUsername || '-';

  const profileTag = mismatch.moreRelevant === 'reported' ? 'dilaporkan' : 'terdaftar di CICERO';
  const reportedProfile = mismatch.reportedProfile;
  const dbProfile = mismatch.dbProfile;

  const profileSummary = [
    `Akun dilaporkan: ${igReported !== '-' ? `IG @${stripAt(igReported)}` : `TikTok @${stripAt(tiktokReported)}`}`,

    reportedProfile
      ? `  followers: ${reportedProfile.followers_count ?? '-'} | postingan: ${reportedProfile.media_count ?? reportedProfile.posts ?? '-'} | private: ${reportedProfile.isPrivate ? 'ya' : 'tidak'}`
      : '  (data profil tidak tersedia)',
    `Akun terdaftar CICERO: ${igDb !== '-' ? `IG @${stripAt(igDb)}` : `TikTok @${stripAt(tiktokDb)}`}`,
    dbProfile
      ? `  followers: ${dbProfile.followers_count ?? '-'} | postingan: ${dbProfile.media_count ?? dbProfile.posts ?? '-'} | private: ${dbProfile.isPrivate ? 'ya' : 'tidak'}`
      : '  (data profil tidak tersedia)',
  ].join('\n');

  return [
    '⚠️ *Konfirmasi Perubahan Username*',
    '',
    `Username yang Anda laporkan *berbeda* dengan yang terdaftar di CICERO.`,
    '',
    profileSummary,
    '',
    `Saran: akun yang lebih relevan → *${profileTag}*`,
    '',
    'Jika Anda ingin memperbarui data CICERO dengan username yang dilaporkan, balas pesan ini dengan:',
    '  *ya konfirmasi ig* — untuk update akun Instagram',
    '  *ya konfirmasi tiktok* — untuk update akun TikTok',
    '',
    'Konfirmasi akan kadaluarsa dalam *15 menit*.',
  ].join('\n');
}

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

export function buildProfileLink(platform, username) {
  if (!username) return '';
  const clean = String(username).replace(/^@/, '');
  if (platform === 'instagram') return `https://instagram.com/${clean}`;
  if (platform === 'tiktok') return `https://tiktok.com/@${clean}`;
  return '';
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

  const profileLinks = triageResult?.evidence?.profileLinks || {};
  const linksText = Object.values(profileLinks).filter(Boolean).join('\n');

  const externalNaNote =
    Array.isArray(triageResult.diagnoses) && triageResult.diagnoses.includes('EXTERNAL_NA')
      ? '\n⚠️ Catatan: layanan verifikasi eksternal (RapidAPI) tidak tersedia — triage menggunakan data internal saja.'
      : '';

  if (triageResult.diagnosisCode === 'USERNAME_MISMATCH') {
    const mismatch = triageResult?.evidence?.mismatch || {};
    const usernameDb = triageResult?.evidence?.internal?.usernameDb || {};
    const profileLinks = triageResult?.evidence?.profileLinks || {};
    const reportedLinks = Object.values(profileLinks).filter(Boolean).join('\n');
    const mismatchIg = parsed?.reporter?.igUsername
      && normalizeHandle(parsed.reporter.igUsername) !== normalizeHandle(usernameDb.instagram);
    const mismatchTiktok = parsed?.reporter?.tiktokUsername
      && normalizeHandle(parsed.reporter.tiktokUsername) !== normalizeHandle(usernameDb.tiktok);

    const lines = [
      `Ditemukan *ketidakcocokan username* pada akun ${platformLabel}.`,
    ];
    if (mismatchIg) {
      lines.push(`  IG laporan: @${stripAt(parsed.reporter.igUsername)} vs CICERO: @${stripAt(usernameDb.instagram || '-')}`);
    }
    if (mismatchTiktok) {
      lines.push(`  TikTok laporan: @${stripAt(parsed.reporter.tiktokUsername)} vs CICERO: @${stripAt(usernameDb.tiktok || '-')}`);
    }
    if (mismatch.moreRelevant) {
      lines.push(`Akun lebih relevan: ${mismatch.moreRelevant === 'reported' ? 'yang dilaporkan' : 'yang terdaftar CICERO'}`);
    }
    lines.push('Langkah cepat:');
    lines.push('1) Samakan username di CICERO dengan akun yang digunakan saat aksi.');
    lines.push('2) Kirim screenshot profil terbaru + bukti aksi, lalu ulangi like/komentar.');
    if (reportedLinks) lines.push(`Profil: ${reportedLinks}`);
    return lines.filter(Boolean).join('\n') + externalNaNote;
  }

  if (triageResult.diagnosisCode === 'ALREADY_PARTICIPATED' || triageResult.diagnoses?.includes('ALREADY_PARTICIPATED')) {
    const latestPostUrl = triageResult?.evidence?.latestPostUrl;
    const lines = [
      `Akun ${platformLabel} telah tercatat *pernah berpartisipasi* sebelumnya.`,
      'Kemungkinan aksi terbaru belum tersinkronisasi dalam window terbaru.',
      'Langkah cepat:',
      '1) Pastikan aksi dilakukan pada konten target resmi yang aktif.',
    ];
    if (latestPostUrl) {
      lines.push(`2) Konten terakhir tercatat: ${latestPostUrl}`);
      lines.push('3) Ulangi aksi pada konten tersebut, lalu tunggu sinkronisasi ±30 menit.');
    } else {
      lines.push('2) Ulangi aksi pada konten target resmi terbaru.');
      lines.push('3) Tunggu sinkronisasi ±30 menit lalu validasi ulang.');
    }
    return lines.join('\n') + externalNaNote;
  }

  if (triageResult.diagnosisCode === 'ACCOUNT_PRIVATE') {
    return [
      `Akun ${platformLabel} terdeteksi *private* / dikunci.`,
      'Akun yang dikunci tidak dapat diverifikasi secara otomatis.',
      'Langkah cepat:',
      '1) Ubah akun ke mode *publik* (tidak dikunci) sementara proses verifikasi.',
      '2) Ulangi aksi like/komentar di konten resmi.',
      '3) Tunggu sinkronisasi ±30 menit, lalu minta validasi ulang.',
      linksText ? `Profil: ${linksText}` : '',
    ].filter(Boolean).join('\n') + externalNaNote;
  }

  if (triageResult.diagnosisCode === 'NO_PROFILE_PHOTO') {
    return [
      `Akun ${platformLabel} terdeteksi *tidak memiliki foto profil*.`,
      'Akun tanpa foto profil tidak memenuhi syarat verifikasi sistem.',
      'Langkah cepat:',
      '1) Tambahkan foto profil yang jelas pada akun tersebut.',
      '2) Ulangi aksi like/komentar di konten resmi.',
      '3) Tunggu sinkronisasi ±30 menit, lalu minta validasi ulang.',
      linksText ? `Profil: ${linksText}` : '',
    ].filter(Boolean).join('\n') + externalNaNote;
  }

  if (triageResult.diagnosisCode === 'NO_CONTENT') {
    return [
      `Hasil verifikasi ${platformLabel}: akun terdeteksi tetapi *belum memiliki postingan* (konten = 0).`,
      'Akun tanpa postingan sulit diverifikasi secara otomatis.',
      'Langkah cepat:',
      '1) Pastikan username di komplain sama persis dengan akun yang dipakai saat tugas.',
      '2) Buat minimal 1 postingan publik pada platform tersebut.',
      '3) Ulangi aksi like/komentar di konten resmi, tunggu sinkronisasi ±30-60 menit.',
      '4) Kirim screenshot profil + bukti aksi terbaru jika masih belum terdata.',
      linksText ? `Profil: ${linksText}` : '',
    ].filter(Boolean).join('\n') + externalNaNote;
  }

  if (triageResult.diagnosisCode === 'LOW_TRUST') {
    return lowActivityTemplate(platformLabel) + (linksText ? `\nProfil: ${linksText}` : '') + externalNaNote;
  }

  if (triageResult.diagnosisCode === 'OK_ACTIVE_VALID') {
    return activeValidTemplate(platformLabel) + externalNaNote;
  }

  const base = [
    `Ringkasan pengecekan: ${triageResult.diagnosisCode.replace(/_/g, ' ').toLowerCase()}.`,
    ...formatVerificationBlock(parsed, triageResult),
    ...formatAuditBlock(triageResult),
    ...formatNextActions(triageResult.nextActions || []),
  ].join('\n');

  return base + externalNaNote;
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
    ...(Array.isArray(triageResult.diagnoses) && triageResult.diagnoses.length
      ? [`Diagnoses: ${triageResult.diagnoses.join(', ')}`]
      : []),
    `Status: ${triageResult.status}`,
    `Confidence: ${triageResult.confidence}`,
    `Aksi: ${(triageResult.nextActions || []).join(' | ') || '-'}`,
  ].join('\n');
}
