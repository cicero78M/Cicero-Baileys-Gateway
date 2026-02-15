import { jest } from '@jest/globals';

const fetchInstagramInfoMock = jest.fn();
const fetchTiktokProfileMock = jest.fn();

jest.unstable_mockModule('../src/db/index.js', () => ({
  query: jest.fn(),
}));

jest.unstable_mockModule('../src/service/instaRapidService.js', () => ({
  fetchInstagramInfo: fetchInstagramInfoMock,
}));

jest.unstable_mockModule('../src/service/tiktokRapidService.js', () => ({
  fetchTiktokProfile: fetchTiktokProfileMock,
}));

jest.unstable_mockModule('../src/model/instaLikeModel.js', () => ({
  hasUserLikedBetween: jest.fn(),
}));

jest.unstable_mockModule('../src/model/tiktokCommentModel.js', () => ({
  hasUserCommentedBetween: jest.fn(),
}));

jest.unstable_mockModule('../src/utils/waHelper.js', () => ({
  normalizeUserWhatsAppId: jest.fn(),
  safeSendMessage: jest.fn(),
}));

jest.unstable_mockModule('../src/service/waService.js', () => ({
  default: {},
  waitForWaReady: jest.fn(),
}));

const {
  isLowOrMissingMetric,
  hasFullMetrics,
  buildAccountStatus,
} = await import('../src/service/complaintService.js');

describe('complaintService metrics threshold', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('isLowOrMissingMetric returns true for null/undefined/- and < 10', () => {
    expect(isLowOrMissingMetric(null)).toBe(true);
    expect(isLowOrMissingMetric(undefined)).toBe(true);
    expect(isLowOrMissingMetric('-')).toBe(true);
    expect(isLowOrMissingMetric(0)).toBe(true);
    expect(isLowOrMissingMetric(9)).toBe(true);
    expect(isLowOrMissingMetric(10)).toBe(false);
    expect(isLowOrMissingMetric('12')).toBe(false);
  });

  test('Instagram 0/0/1 masuk kategori minim aktivitas', async () => {
    fetchInstagramInfoMock.mockResolvedValue({
      followers_count: 0,
      following_count: 0,
      media_count: 1,
      is_private: false,
    });
    fetchTiktokProfileMock.mockResolvedValue({});

    const status = await buildAccountStatus({ insta: '@igtest', tiktok: '' });

    expect(status.instagram.reviewNote).toContain('terdeteksi minim aktivitas');
    expect(status.instagram.reviewNote).toContain('Menggunakan foto profil yang jelas dan sesuai.');
  });

  test('TikTok video/followers/following/likes low-or-missing masuk kategori minim aktivitas', async () => {
    fetchInstagramInfoMock.mockResolvedValue({});
    fetchTiktokProfileMock.mockResolvedValue({
      username: 'tttest',
      video_count: '-',
      follower_count: 8,
      following_count: '-',
      like_count: '-',
    });

    const status = await buildAccountStatus({ insta: '', tiktok: '@tttest' });

    expect(status.tiktok.reviewNote).toContain('terdeteksi minim aktivitas');
    expect(status.tiktok.likes).toBe('-');
  });

  test('profil dengan metrik >=10 tetap aktif valid', () => {
    expect(
      hasFullMetrics({
        posts: 10,
        followers: 15,
        following: 20,
      })
    ).toBe(true);

    expect(
      hasFullMetrics({
        posts: 10,
        followers: 9,
        following: 20,
      })
    ).toBe(false);
  });
});
