import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/utils/broadcastMatcher.js', () => ({
  hasAnyKeyword: jest.fn(),
  hasAllKeywords: jest.fn(),
}));

let isBroadcastMessage, extractUrls, formatDate;
let mockHasAnyKeyword, mockHasAllKeywords;

beforeAll(async () => {
  ({ hasAnyKeyword: mockHasAnyKeyword, hasAllKeywords: mockHasAllKeywords } =
    await import('../src/utils/broadcastMatcher.js'));
  ({ isBroadcastMessage, extractUrls, formatDate } =
    await import('../src/service/sosmedBroadcastParser.js'));
});

beforeEach(() => {
  jest.clearAllMocks();
});

const defaultConfig = {
  broadcast_trigger_keywords: 'pagi,siang,sore,malam',
  broadcast_required_phrase: 'mohon izin dibantu',
  broadcast_action_keywords: 'like,comment,share,follow,subscribe,repost',
};

describe('isBroadcastMessage', () => {
  test('returns true for valid broadcast text', () => {
    mockHasAnyKeyword
      .mockReturnValueOnce(true)   // salam check
      .mockReturnValueOnce(true);  // action check
    const text = 'Selamat pagi\nMohon izin dibantu\nLike\nhttps://instagram.com/p/abc';
    expect(isBroadcastMessage(text, defaultConfig)).toBe(true);
  });

  test('returns false when salam keyword missing', () => {
    mockHasAnyKeyword.mockReturnValueOnce(false);
    expect(isBroadcastMessage('Mohon izin dibantu like', defaultConfig)).toBe(false);
    expect(mockHasAnyKeyword).toHaveBeenCalledTimes(1);
  });

  test('returns false when required phrase missing', () => {
    mockHasAnyKeyword.mockReturnValueOnce(true); // salam present
    const text = 'Selamat pagi, tolong like postingan ini';
    // phrase "mohon izin dibantu" not in text
    expect(isBroadcastMessage(text, defaultConfig)).toBe(false);
  });

  test('returns false when action keyword missing', () => {
    mockHasAnyKeyword
      .mockReturnValueOnce(true)   // salam present
      .mockReturnValueOnce(false); // no action
    const text = 'Selamat pagi\nMohon izin dibantu\nhttps://instagram.com/p/abc';
    expect(isBroadcastMessage(text, defaultConfig)).toBe(false);
  });

  test('returns true when message uses "ijin" spelling (izin/ijin variant)', () => {
    mockHasAnyKeyword
      .mockReturnValueOnce(true)   // salam check
      .mockReturnValueOnce(true);  // action check
    const text = 'Selamat pagi\nMohon ijin dibantu\nLike\nhttps://instagram.com/p/abc';
    expect(isBroadcastMessage(text, defaultConfig)).toBe(true);
  });

  test('returns false for empty string', () => {
    expect(isBroadcastMessage('', defaultConfig)).toBe(false);
  });

  test('returns false for null', () => {
    expect(isBroadcastMessage(null, defaultConfig)).toBe(false);
  });
});

describe('extractUrls', () => {
  test('captures Instagram URLs', () => {
    const text = 'Tolong like https://www.instagram.com/p/ABC123/ ya';
    const { igUrls, tiktokUrls } = extractUrls(text);
    expect(igUrls).toContain('https://www.instagram.com/p/ABC123/');
    expect(tiktokUrls).toHaveLength(0);
  });

  test('captures TikTok URLs', () => {
    const text = 'Watch https://www.tiktok.com/@user/video/12345 please';
    const { igUrls, tiktokUrls } = extractUrls(text);
    expect(tiktokUrls).toContain('https://www.tiktok.com/@user/video/12345');
    expect(igUrls).toHaveLength(0);
  });

  test('captures ig.me short links', () => {
    const text = 'https://ig.me/p/xyz click here';
    const { igUrls } = extractUrls(text);
    expect(igUrls).toContain('https://ig.me/p/xyz');
  });

  test('captures vm.tiktok.com short links', () => {
    const text = 'share https://vm.tiktok.com/abcdef/ ini';
    const { tiktokUrls } = extractUrls(text);
    expect(tiktokUrls).toContain('https://vm.tiktok.com/abcdef/');
  });

  test('captures vt.tiktok.com short links', () => {
    const text = 'share https://vt.tiktok.com/abcdef/ ini';
    const { tiktokUrls } = extractUrls(text);
    expect(tiktokUrls).toContain('https://vt.tiktok.com/abcdef/');
  });

  test('ignores non-platform URLs (FR-007)', () => {
    const text = 'kunjungi https://www.google.com dan https://facebook.com/post';
    const { igUrls, tiktokUrls } = extractUrls(text);
    expect(igUrls).toHaveLength(0);
    expect(tiktokUrls).toHaveLength(0);
  });

  test('handles mixed URL message', () => {
    const text = [
      'https://www.instagram.com/p/IG1',
      'https://www.tiktok.com/@u/video/TK1',
      'https://www.youtube.com/watch?v=yt1',
    ].join(' ');
    const { igUrls, tiktokUrls } = extractUrls(text);
    expect(igUrls).toHaveLength(1);
    expect(tiktokUrls).toHaveLength(1);
  });

  test('deduplicates repeated URLs', () => {
    const url = 'https://www.instagram.com/p/ABC123/';
    const { igUrls } = extractUrls(`${url} ${url}`);
    expect(igUrls).toHaveLength(1);
  });

  test('returns empty arrays for empty string', () => {
    const { igUrls, tiktokUrls } = extractUrls('');
    expect(igUrls).toHaveLength(0);
    expect(tiktokUrls).toHaveLength(0);
  });
});

describe('formatDate', () => {
  test('returns correct Indonesian day and month names', () => {
    // Wednesday 25 March 2026 in Jakarta
    const date = new Date('2026-03-25T00:00:00+07:00');
    const result = formatDate(date);
    expect(result).toBe('Rabu, 25 Maret 2026');
  });

  test('returns correct day/month for different date', () => {
    // Tuesday 1 January 2026
    const date = new Date('2026-01-01T06:00:00+07:00');
    const result = formatDate(date);
    expect(result).toContain('Januari');
    expect(result).toContain('2026');
  });
});
