import { jest } from '@jest/globals';

const mockGetRekap = jest.fn();
const mockFindClientById = jest.fn();
jest.unstable_mockModule('../src/model/instaLikeModel.js', () => ({
  getRekapLikesByClient: mockGetRekap
}));
jest.unstable_mockModule('../src/model/clientModel.js', () => ({
  findById: mockFindClientById,
}));
jest.unstable_mockModule('../src/middleware/debugHandler.js', () => ({
  sendConsoleDebug: jest.fn()
}));
jest.unstable_mockModule('../src/service/instaPostService.js', () => ({}));
jest.unstable_mockModule('../src/service/instaPostKhususService.js', () => ({}));
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
jest.unstable_mockModule('../src/utils/response.js', () => ({ sendSuccess: jest.fn() }));

let getInstaRekapLikes;
beforeAll(async () => {
  ({ getInstaRekapLikes } = await import('../src/controller/instaController.js'));
});

beforeEach(() => {
  mockGetRekap.mockReset();
  mockFindClientById.mockReset();
});

test('accepts tanggal_mulai and tanggal_selesai', async () => {
  mockGetRekap.mockResolvedValue({ rows: [], totalKonten: 0 });
  const req = {
    query: {
      client_id: 'c1',
      periode: 'harian',
      tanggal_mulai: '2024-01-01',
      tanggal_selesai: '2024-01-31'
    }
  };
  const json = jest.fn();
  const res = { json };
  await getInstaRekapLikes(req, res);
  expect(mockGetRekap).toHaveBeenCalledWith(
    'c1',
    'harian',
    undefined,
    '2024-01-01',
    '2024-01-31',
    undefined,
    { regionalId: null }
  );
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ chartHeight: 320 }));
});

test('returns 403 when client_id unauthorized', async () => {
  const req = {
    query: { client_id: 'c2' },
    user: { client_ids: ['c1'] }
  };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getInstaRekapLikes(req, res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(json).toHaveBeenCalledWith({ success: false, message: 'client_id tidak diizinkan' });
  expect(mockGetRekap).not.toHaveBeenCalled();
});

test('allows authorized client_id', async () => {
  mockGetRekap.mockResolvedValue({ rows: [], totalKonten: 0 });
  const req = {
    query: { client_id: 'c1' },
    user: { client_ids: ['c1', 'c2'] }
  };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getInstaRekapLikes(req, res);
  expect(res.status).not.toHaveBeenCalledWith(403);
  expect(mockGetRekap).toHaveBeenCalledWith(
    'c1',
    'harian',
    undefined,
    undefined,
    undefined,
    undefined,
    { regionalId: null }
  );
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});

test('supports client_ids as string', async () => {
  mockGetRekap.mockResolvedValue({ rows: [], totalKonten: 0 });
  const req = {
    query: { client_id: 'c1' },
    user: { client_ids: 'c1' }
  };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getInstaRekapLikes(req, res);
  expect(res.status).not.toHaveBeenCalledWith(403);
  expect(mockGetRekap).toHaveBeenCalledWith(
    'c1',
    'harian',
    undefined,
    undefined,
    undefined,
    undefined,
    { regionalId: null }
  );
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});

test('allows org operator scope using token client_id', async () => {
  mockGetRekap.mockResolvedValue({ rows: [], totalKonten: 0 });
  mockFindClientById.mockResolvedValueOnce({ client_type: 'org' });
  const req = {
    query: { client_id: 'DIR1', role: 'operator', scope: 'ORG' },
    user: { client_id: 'ORG1', client_ids: ['DIR1'] }
  };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getInstaRekapLikes(req, res);
  expect(res.status).not.toHaveBeenCalledWith(403);
  expect(mockGetRekap).toHaveBeenCalledWith(
    'ORG1',
    'harian',
    undefined,
    undefined,
    undefined,
    'operator',
    {
      postClientId: 'ORG1',
      userClientId: 'ORG1',
      userRoleFilter: 'operator',
      includePostRoleFilter: false,
      matchLikeClientId: true,
      officialAccountsOnly: true,
      regionalId: null,
    }
  );
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});

test('returns user like summaries', async () => {
  const rows = [
    { username: 'alice', jumlah_like: 4 },
    { username: 'bob', jumlah_like: 1 },
    { username: 'charlie', jumlah_like: 0 },
    { username: null, jumlah_like: 0 }
  ];
  mockGetRekap.mockResolvedValue({ rows, totalKonten: 4 });
  const req = {
    query: { client_id: 'c1' },
    user: { client_ids: ['c1'] }
  };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getInstaRekapLikes(req, res);
  expect(json).toHaveBeenCalledWith(
    expect.objectContaining({
      success: true,
      totalPosts: 4,
      usersCount: 4,
      sudahUsers: ['alice'],
      kurangUsers: ['bob'],
      belumUsers: ['charlie'],
      sudahUsersCount: 1,
      kurangUsersCount: 1,
      belumUsersCount: 2,
      noUsernameUsersCount: 1,
      summary: expect.objectContaining({
        distribution: expect.objectContaining({
          sudah: 1,
          kurang: 1,
          belum: 1,
          noUsername: 1,
        }),
      }),
      data: expect.arrayContaining([
        expect.objectContaining({ username: 'alice', status: 'sudah' }),
        expect.objectContaining({ username: 'bob', status: 'kurang' }),
        expect.objectContaining({ username: 'charlie', status: 'belum' }),
      ]),
      insights: expect.any(Array),
      statusLegend: expect.arrayContaining([
        expect.objectContaining({ status: 'sudah' }),
        expect.objectContaining({ status: 'kurang' }),
        expect.objectContaining({ status: 'belum' }),
      ]),
    })
  );
});
