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
