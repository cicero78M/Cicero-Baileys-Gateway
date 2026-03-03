import { parseComplaintMessage } from '../src/service/complaintParser.js';

describe('complaintParser', () => {
  test('extracts complaint fields and numbered issues from Rincian Kendala', () => {
    const input = [
      '*Pesan Komplain*',
      'NRP: 75020201',
      'Nama: Budi',
      'Polres: Polres Kota',
      'Username IG: @budi.ig',
      'Username TikTok: @buditt',
      '',
      'Rincian Kendala:',
      '1) Sudah like belum terdata',
      '2. Sudah komentar belum terdata',
    ].join('\n');

    const result = parseComplaintMessage(input);

    expect(result.isComplaint).toBe(true);
    expect(result.reporter).toEqual({
      nrp: '75020201',
      nama: 'Budi',
      polres: 'Polres Kota',
      igUsername: '@budi.ig',
      tiktokUsername: '@buditt',
    });
    expect(result.issues).toEqual([
      'Sudah like belum terdata',
      'Sudah komentar belum terdata',
    ]);
  });

  test('normalizes Instagram and TikTok profile links into handles', () => {
    const input = [
      'Pesan Komplain',
      'NRP: 94070752',
      'Username IG: https://www.instagram.com/polsek_pagerwojo?igsh=MTY0Y29pdjc5M3UxcQ==',
      'Username TikTok: https://www.tiktok.com/@polsek_pagerwojo?_r=1&_t=ZS-94NjrZjcqPp',
    ].join('\n');

    const result = parseComplaintMessage(input);

    expect(result.reporter.igUsername).toBe('@polsek_pagerwojo');
    expect(result.reporter.tiktokUsername).toBe('@polsek_pagerwojo');
  });

  test('supports detail kendala header and bullet extraction', () => {
    const input = [
      'Pesan Komplain',
      'NRP/NIP: 88888',
      '',
      'Detail Kendala',
      '- Data IG belum masuk',
      '• Data TikTok belum masuk',
    ].join('\n');

    const result = parseComplaintMessage(input);

    expect(result.isComplaint).toBe(true);
    expect(result.reporter.nrp).toBe('88888');
    expect(result.issues).toEqual(['Data IG belum masuk', 'Data TikTok belum masuk']);
  });
});
