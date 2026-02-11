import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

const mockFetchTiktokProfile = jest.fn();
const mockFetchTiktokPosts = jest.fn();
const mockFetchTiktokPostsBySecUid = jest.fn();
const mockFetchTiktokInfo = jest.fn();
const mockGetProfile = jest.fn();
const mockSetProfile = jest.fn();
const mockFindClientById = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();

jest.unstable_mockModule('../src/config/env.js', () => ({
  env: { REDIS_URL: 'redis://localhost:6379' },
}));

jest.unstable_mockModule('../src/config/redis.js', () => ({
  default: { get: mockRedisGet, set: mockRedisSet },
}));

jest.unstable_mockModule('../src/service/tiktokApi.js', () => ({
  fetchTiktokProfile: mockFetchTiktokProfile,
  fetchTiktokPosts: mockFetchTiktokPosts,
  fetchTiktokPostsBySecUid: mockFetchTiktokPostsBySecUid,
  fetchTiktokInfo: mockFetchTiktokInfo,
}));

jest.unstable_mockModule('../src/service/profileCacheService.js', () => ({
  getProfile: mockGetProfile,
  setProfile: mockSetProfile,
}));

jest.unstable_mockModule('../src/service/clientService.js', () => ({
  findClientById: mockFindClientById,
}));

jest.unstable_mockModule('../src/service/tiktokPostService.js', () => ({}));
jest.unstable_mockModule('../src/service/tiktokCommentService.js', () => ({}));
jest.unstable_mockModule('../src/middleware/dashboardAuth.js', () => ({
  verifyDashboardToken: (req, res, next) => next(),
}));

let app;
let router;

const invalidMessage =
  'Format username TikTok tidak valid. Gunakan tautan profil atau username seperti tiktok.com/@username atau @username.';

beforeAll(async () => {
  ({ default: router } = await import('../src/routes/tiktokRoutes.js'));
  app = express();
  app.use('/api/tiktok', router);
});

beforeEach(() => {
  mockFetchTiktokProfile.mockReset();
  mockFetchTiktokPosts.mockReset();
  mockFetchTiktokPostsBySecUid.mockReset();
  mockFetchTiktokInfo.mockReset();
  mockGetProfile.mockReset();
  mockSetProfile.mockReset();
  mockFindClientById.mockReset();
  mockRedisGet.mockReset();
  mockRedisSet.mockReset();
});

describe('TikTok rapid endpoints username validation', () => {
  test('rapid-profile rejects malformed usernames before hitting cache', async () => {
    const res = await request(app)
      .get('/api/tiktok/rapid-profile')
      .query({ username: 'https://example.com/@bad-user' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: invalidMessage });
    expect(mockGetProfile).not.toHaveBeenCalled();
    expect(mockFetchTiktokProfile).not.toHaveBeenCalled();
  });

  test('rapid-posts rejects malformed usernames before RapidAPI', async () => {
    const res = await request(app)
      .get('/api/tiktok/rapid-posts')
      .query({ username: 'user name with spaces' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: invalidMessage });
    expect(mockFetchTiktokPosts).not.toHaveBeenCalled();
    expect(mockFetchTiktokPostsBySecUid).not.toHaveBeenCalled();
  });
});
