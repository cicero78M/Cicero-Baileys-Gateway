import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const mockGetRekap = jest.fn();
jest.unstable_mockModule('../src/model/instaLikeModel.js', () => ({
  getRekapLikesByClient: mockGetRekap
}));
jest.unstable_mockModule('../src/middleware/debugHandler.js', () => ({
  sendConsoleDebug: jest.fn()
}));

let likesRoutes;
beforeAll(async () => {
  ({ default: likesRoutes } = await import('../src/routes/likesRoutes.js'));
});

beforeEach(() => {
  mockGetRekap.mockReset();
});

test('GET /likes/instagram returns ditbinmas like summary', async () => {
  const rows = [
    { username: 'alice', jumlah_like: 4 },
    { username: 'bob', jumlah_like: 1 },
    { username: 'charlie', jumlah_like: 0 },
    { username: null, jumlah_like: 0 }
  ];
  mockGetRekap.mockResolvedValue({ rows, totalKonten: 4 });

  const app = express();
  app.use('/api/likes', likesRoutes);

  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  const res = await request(app).get('/api/likes/instagram');

  expect(res.status).toBe(200);
  expect(mockGetRekap).toHaveBeenCalledWith('ditbinmas', 'harian', undefined, undefined, undefined, 'ditbinmas');
  expect(res.body.success).toBe(true);
  expect(res.body.chartHeight).toBe(320);
  expect(res.body.totalPosts).toBe(4);
  expect(res.body.usersCount).toBe(4);
  expect(res.body.sudahUsers).toEqual(['alice']);
  expect(res.body.kurangUsers).toEqual(['bob']);
  expect(res.body.belumUsers).toEqual(['charlie']);
  expect(res.body.sudahUsersCount).toBe(1);
  expect(res.body.kurangUsersCount).toBe(1);
  expect(res.body.belumUsersCount).toBe(2);
  expect(res.body.noUsernameUsersCount).toBe(1);
  expect(res.body.summary).toEqual(
    expect.objectContaining({
      totalPosts: 4,
      totalUsers: 4,
      totalLikes: 5,
      distribution: expect.objectContaining({
        sudah: 1,
        kurang: 1,
        belum: 1,
        noUsername: 1,
      }),
    })
  );
  expect(res.body.summary.averageCompletionPercentage).toBeCloseTo(41.7);
  expect(res.body.summary.participationRatePercentage).toBeCloseTo(66.7);
  expect(res.body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        username: 'alice',
        status: 'sudah',
        completionPercentage: 100,
        missingLikes: 0,
        ranking: 1,
      }),
      expect.objectContaining({
        username: 'bob',
        status: 'kurang',
        completionPercentage: 25,
        missingLikes: 3,
      }),
      expect.objectContaining({
        username: 'charlie',
        status: 'belum',
        completionPercentage: 0,
        missingLikes: 4,
      }),
      expect.objectContaining({
        username: null,
        status: 'no_username',
        completionPercentage: 0,
      }),
    ])
  );
  expect(res.body.chartData).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: 'alice', likes: 4, missingLikes: 0 }),
    ])
  );
  expect(res.body.insights).toEqual(
    expect.arrayContaining([
      expect.stringContaining('✅ 1 akun'),
      expect.stringContaining('⚠️ 1 akun'),
      expect.stringContaining('⏳ 1 akun'),
      expect.stringContaining('❗ 1 akun'),
    ])
  );
  expect(res.body.statusLegend).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ status: 'sudah' }),
      expect.objectContaining({ status: 'kurang' }),
      expect.objectContaining({ status: 'belum' }),
      expect.objectContaining({ status: 'no_username' }),
    ])
  );
  expect(res.body.noUsernameUsersDetails).toHaveLength(1);

  expect(logSpy).toHaveBeenCalledWith('\x1b[33m%s\x1b[0m', 'GET /api/likes/instagram');
  logSpy.mockRestore();
});
