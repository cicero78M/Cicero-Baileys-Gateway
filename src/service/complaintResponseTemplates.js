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
    ...(triageResult.nextActions || []).map((item, index) => `${index + 1}) ${item}`),
  ].join('\n');
}

export function buildAdminSummary(triageResult, parsed) {
  return [
    '📌 *Complaint Triage Summary*',
    `NRP: ${parsed?.reporter?.nrp || '-'}`,
    `Nama: ${parsed?.reporter?.nama || '-'}`,
    `IG: ${parsed?.reporter?.igUsername || '-'}`,
    `TikTok: ${parsed?.reporter?.tiktokUsername || '-'}`,
    `Diagnosis: ${triageResult.diagnosisCode}`,
    `Status: ${triageResult.status}`,
    `Confidence: ${triageResult.confidence}`,
    `Aksi: ${(triageResult.nextActions || []).join(' | ') || '-'}`,
  ].join('\n');
}
