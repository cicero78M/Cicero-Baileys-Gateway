import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/service/clientService.js', () => ({
  findClientById: jest.fn(),
}));

jest.unstable_mockModule('../../src/handler/fetchpost/instaFetchPost.js', () => ({
  fetchSinglePostKhusus: jest.fn(),
}));

jest.unstable_mockModule('../../src/handler/fetchpost/tiktokFetchPost.js', () => ({
  fetchAndStoreSingleTiktokPost: jest.fn(),
}));

jest.unstable_mockModule('../../src/handler/fetchabsensi/sosmedTask.js', () => ({
  generateSosmedTaskMessage: jest.fn(),
}));

let cleanText;
let isSosmedTaskBroadcastFormat;

beforeAll(async () => {
  ({ cleanText, isSosmedTaskBroadcastFormat } = await import('../../src/service/waAutoSosmedTaskService.js'));
});

describe('waAutoSosmedTaskService parser', () => {
  test('cleanText menormalisasi escaped newline, tanda baca, dan zero-width chars', () => {
    const raw = 'Selamat sore, komandan\\nMohon izin dibantu\u200B: follow!';

    expect(cleanText(raw)).toBe('Selamat sore  komandan Mohon izin dibantu  follow ');
  });

  test('lolos untuk format user dengan escaped newline dan variasi "mohon izin dibantu"', () => {
    const text =
      'Selamat sore komandan, senior dan rr\\nMohon izin dibantu\\nSilakan follow akun berikut\\nhttps://instagram.com/p/abc123';

    expect(isSosmedTaskBroadcastFormat(text)).toBe(true);
  });

  test('lolos untuk variasi "mohon ijin bantu" + salam multi sapaan setelah waktu', () => {
    const text =
      'Selamat siang komandan, senior dan rr\nMohon ijin bantu\nMohon repost posting ini\nhttps://www.tiktok.com/@abc/video/123';

    expect(isSosmedTaskBroadcastFormat(text)).toBe(true);
  });

  test('gagal bila tidak ada URL sosmed didukung dan log debug memuat rule gagal', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const text = 'Selamat pagi komandan\nMohon izin dibantu\nFollow akun ini';

    const result = isSosmedTaskBroadcastFormat(text);

    expect(result).toBe(false);
    expect(debugSpy).toHaveBeenCalledWith(
      '[AUTO-SOSMED-TASK] Broadcast parser eval:',
      expect.objectContaining({
        normalizedForMatch: expect.any(String),
        failedRequirements: expect.arrayContaining(['minimal 1 URL sosmed didukung']),
      })
    );

    debugSpy.mockRestore();
  });
});
