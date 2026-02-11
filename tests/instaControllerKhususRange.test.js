import { jest } from '@jest/globals';

const mockFindToday = jest.fn();
const mockFindRange = jest.fn();
jest.unstable_mockModule('../src/model/instaLikeModel.js', () => ({
  getRekapLikesByClient: jest.fn(),
}));
jest.unstable_mockModule('../src/middleware/debugHandler.js', () => ({
  sendConsoleDebug: jest.fn(),
}));
jest.unstable_mockModule('../src/service/instaPostService.js', () => ({}));
jest.unstable_mockModule('../src/service/instaPostKhususService.js', () => ({
  findTodayByClientId: mockFindToday,
  findByClientIdRange: mockFindRange,
}));
jest.unstable_mockModule('../src/service/instagramApi.js', () => ({
  fetchInstagramPosts: jest.fn(),
  fetchInstagramProfile: jest.fn(),
  fetchInstagramInfo: jest.fn(),
  fetchInstagramPostsByMonthToken: jest.fn(),
}));
jest.unstable_mockModule('../src/service/instaProfileService.js', () => ({}));
jest.unstable_mockModule('../src/service/instagramUserService.js', () => ({}));
jest.unstable_mockModule('../src/service/instaPostCacheService.js', () => ({}));
jest.unstable_mockModule('../src/service/profileCacheService.js', () => ({}));

const mockSendSuccess = jest.fn();
jest.unstable_mockModule('../src/utils/response.js', () => ({
  sendSuccess: mockSendSuccess,
}));

let getInstaPostsKhusus;
beforeAll(async () => {
  ({ getInstaPostsKhusus } = await import('../src/controller/instaController.js'));
});

beforeEach(() => {
  mockFindToday.mockReset();
  mockFindRange.mockReset();
  mockSendSuccess.mockReset();
});

test('returns today\'s posts when available', async () => {
  const posts = [{ id: 1 }];
  mockFindToday.mockResolvedValue(posts);
  const req = { query: { client_id: 'c1' } };
  const res = {};
  await getInstaPostsKhusus(req, res);
  expect(mockFindToday).toHaveBeenCalledWith('c1');
  expect(mockFindRange).not.toHaveBeenCalled();
  expect(mockSendSuccess).toHaveBeenCalledWith(res, posts);
});

test('falls back to range when today empty and days provided', async () => {
  mockFindToday.mockResolvedValue([]);
  const rangePosts = [{ id: 2 }];
  mockFindRange.mockResolvedValue(rangePosts);
  const req = { query: { client_id: 'c1', days: '7' } };
  const res = {};
  await getInstaPostsKhusus(req, res);
  expect(mockFindToday).toHaveBeenCalledWith('c1');
  expect(mockFindRange).toHaveBeenCalledWith('c1', {
    days: 7,
    startDate: undefined,
    endDate: undefined,
  });
  expect(mockSendSuccess).toHaveBeenCalledWith(res, rangePosts);
});

test('falls back to range when today empty and start/end provided', async () => {
  mockFindToday.mockResolvedValue([]);
  const rangePosts = [{ id: 3 }];
  mockFindRange.mockResolvedValue(rangePosts);
  const req = {
    query: {
      client_id: 'c1',
      start_date: '2024-01-01',
      end_date: '2024-01-10',
    },
  };
  const res = {};
  await getInstaPostsKhusus(req, res);
  expect(mockFindRange).toHaveBeenCalledWith('c1', {
    days: undefined,
    startDate: '2024-01-01',
    endDate: '2024-01-10',
  });
  expect(mockSendSuccess).toHaveBeenCalledWith(res, rangePosts);
});
