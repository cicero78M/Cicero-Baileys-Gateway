import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const mockQuery = jest.fn();
const mockRedis = { sAdd: jest.fn(), set: jest.fn(), sMembers: jest.fn(), del: jest.fn() };
const mockInsertLoginLog = jest.fn();
const mockWAClient = {
  info: {},
  sendMessage: jest.fn(),
  getState: jest.fn().mockResolvedValue('CONNECTED'),
  once: jest.fn(),
  off: jest.fn(),
};
const mockQueueAdminNotification = jest.fn();
const mockGetPremiumSnapshot = jest.fn();
const actualWaHelper = await import('../src/utils/waHelper.js');

jest.unstable_mockModule('../src/db/index.js', () => ({
  query: mockQuery
}));

jest.unstable_mockModule('../src/config/redis.js', () => ({
  default: mockRedis
}));

jest.unstable_mockModule('../src/model/loginLogModel.js', () => ({
  insertLoginLog: mockInsertLoginLog,
  getLoginLogs: jest.fn()
}));

jest.unstable_mockModule('../src/utils/waHelper.js', () => ({
  ...actualWaHelper,
  getAdminWAIds: () => ['admin@c.us'],
  formatToWhatsAppId: (nohp) => `${nohp}@c.us`
}));

jest.unstable_mockModule('../src/service/waService.js', () => ({
  default: mockWAClient,
  waitForWaReady: () => Promise.resolve(),
  queueAdminNotification: mockQueueAdminNotification,
}));

jest.unstable_mockModule('../src/service/dashboardSubscriptionService.js', () => ({
  getPremiumSnapshot: mockGetPremiumSnapshot,
}));

let app;
let authRoutes;
let passwordResetRoutes;

beforeAll(async () => {
  process.env.JWT_SECRET = 'testsecret';
  const mod = await import('../src/routes/authRoutes.js');
  authRoutes = mod.default;
  const passwordResetMod = await import('../src/routes/passwordResetAliasRoutes.js');
  passwordResetRoutes = passwordResetMod.default;
  app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/password-reset', passwordResetRoutes);
});

beforeEach(() => {
  mockQuery.mockReset();
  mockRedis.sAdd.mockReset();
  mockRedis.set.mockReset();
  mockRedis.sMembers.mockReset();
  mockRedis.del.mockReset();
  mockRedis.sMembers.mockResolvedValue([]);
  mockRedis.del.mockResolvedValue(1);
  mockInsertLoginLog.mockReset();
  mockWAClient.sendMessage.mockReset();
  mockQueueAdminNotification.mockReset();
  mockGetPremiumSnapshot.mockReset();
  mockGetPremiumSnapshot.mockResolvedValue({
    premiumStatus: false,
    premiumTier: null,
    premiumExpiresAt: null,
  });
});

describe('POST /login', () => {
  test('returns token and client data on success', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ client_id: '1', nama: 'Client', client_operator: '0812' }]
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ client_id: '1', client_operator: '0812' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.client).toEqual({ client_id: '1', nama: 'Client', role: 'client' });
    const token = res.body.token;
    expect(typeof token).toBe('string');
    expect(mockRedis.sAdd).toHaveBeenCalledWith(`login:1`, token);
    expect(mockRedis.set).toHaveBeenCalledWith(`login_token:${token}`, '1', { EX: 2 * 60 * 60 });
    expect(mockInsertLoginLog).toHaveBeenCalledWith({
      actorId: '1',
      loginType: 'operator',
      loginSource: 'mobile'
    });
  });

  test('sets role to client_id for direktorat client', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          client_id: 'DIT1',
          nama: 'Dit',
          client_operator: '0812',
          client_type: 'direktorat'
        }
      ]
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ client_id: 'DIT1', client_operator: '0812' });

    expect(res.status).toBe(200);
    expect(res.body.client).toEqual({ client_id: 'DIT1', nama: 'Dit', role: 'dit1' });
  });

  test('returns 401 when client not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ client_id: '9', client_operator: '0812' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(mockRedis.sAdd).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});

describe('POST /penmas-register', () => {
  test('creates new user when username free', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] });

    const res = await request(app)
      .post('/api/auth/penmas-register')
      .send({ username: 'user', password: 'pass' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.user_id).toBe('string');
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      'SELECT * FROM penmas_user WHERE username = $1',
      ['user']
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO penmas_user'),
      [expect.any(String), 'user', expect.any(String), 'penulis']
    );
  });

  test('returns 400 when username exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'x' }] });

    const res = await request(app)
      .post('/api/auth/penmas-register')
      .send({ username: 'user', password: 'pass' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('POST /penmas-login', () => {
  test('logs in existing user with correct password', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          user_id: 'u1',
          username: 'user',
          password_hash: await bcrypt.hash('pass', 10),
          role: 'penulis'
        }
      ]
    });

    const res = await request(app)
      .post('/api/auth/penmas-login')
      .send({ username: 'user', password: 'pass' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toEqual({ user_id: 'u1', role: 'penulis' });
    expect(mockRedis.sAdd).toHaveBeenCalledWith('penmas_login:u1', res.body.token);
    expect(mockRedis.set).toHaveBeenCalledWith(
      `login_token:${res.body.token}`,
      'penmas:u1',
      { EX: 2 * 60 * 60 }
    );
    expect(mockInsertLoginLog).toHaveBeenCalledWith({
      actorId: 'u1',
      loginType: 'operator',
      loginSource: 'web'
    });
  });

  test('returns 401 when password wrong', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          user_id: 'u1',
          username: 'user',
          password_hash: await bcrypt.hash('pass', 10),
          role: 'penulis'
        }
      ]
    });

    const res = await request(app)
      .post('/api/auth/penmas-login')
      .send({ username: 'user', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(mockRedis.sAdd).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  test('returns 403 when status pending', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          user_id: 'd1',
          username: 'dash',
          password_hash: await bcrypt.hash('pass', 10),
          role: 'admin',
          status: false
        }
      ]
    });

    const res = await request(app)
      .post('/api/auth/dashboard-login')
      .send({ username: 'dash', password: 'pass' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(mockRedis.sAdd).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});

describe('POST /user-register', () => {
  test('creates new user when nrp free', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ user_id: '1', ditbinmas: false, ditlantas: false, bidhumas: false, operator: false }] });

    const res = await request(app)
      .post('/api/auth/user-register')
      .send({ nrp: '1', nama: 'User', client_id: 'c1' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      'SELECT * FROM "user" WHERE user_id = $1',
      ['1']
    );
    expect(mockQuery.mock.calls[1][0]).toContain('INSERT INTO "user"');
    expect(mockQuery.mock.calls.length).toBe(3);
  });

  test('returns 400 when nrp exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: '1' }] });

    const res = await request(app)
      .post('/api/auth/user-register')
      .send({ nrp: '1', nama: 'User', client_id: 'c1' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('POST /dashboard-register', () => {
  test('creates new dashboard user when username free', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ role_id: 1, role_name: 'operator' }] })
      .mockResolvedValueOnce({ rows: [{ dashboard_user_id: 'd1', status: false }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/dashboard-register')
      .send({ username: 'dash', password: 'pass', whatsapp: '0812-1234x', client_ids: ['c1'] });

    expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe(false);
      expect(res.body.dashboard_user_id).toBeDefined();
      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('FROM dashboard_user'),
        ['dash']
      );
      expect(mockQuery.mock.calls[1][0]).toContain('FROM roles');
      expect(mockQuery).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO dashboard_user'),
        [expect.any(String), 'dash', expect.any(String), 1, false, '628121234']
      );
      expect(mockQuery).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining('INSERT INTO dashboard_user_clients'),
        [expect.any(String), 'c1']
      );
      expect(mockWAClient.sendMessage).toHaveBeenCalledTimes(2);
      expect(mockWAClient.sendMessage).toHaveBeenCalledWith(
        'admin@c.us',
        expect.stringContaining('Permintaan User Approval'),
        {}
      );
      expect(mockWAClient.sendMessage).toHaveBeenCalledWith(
        '628121234@c.us',
        expect.stringContaining('Permintaan registrasi dashboard Anda telah diterima'),
        {}
      );
  });

  test('accepts single client_id field', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ role_id: 1, role_name: 'operator' }] })
      .mockResolvedValueOnce({ rows: [{ dashboard_user_id: 'd1', status: false }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/dashboard-register')
      .send({ username: 'dash', password: 'pass', whatsapp: '0812-1234x', client_id: 'c1' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(mockQuery).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('INSERT INTO dashboard_user_clients'),
      [expect.any(String), 'c1']
    );
  });

  test('creates dashboard user with specified role name', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ role_id: 5, role_name: 'ditbinmas' }] })
      .mockResolvedValueOnce({ rows: [{ dashboard_user_id: 'd1', status: false }] });

    const res = await request(app)
      .post('/api/auth/dashboard-register')
      .send({ username: 'dash', password: 'pass', whatsapp: '0812-1234x', role: 'ditbinmas' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(mockQuery.mock.calls[1][0]).toContain('FROM roles');
    expect(mockQuery.mock.calls[1][1]).toEqual(['ditbinmas']);
    expect(mockQuery.mock.calls[2][1][3]).toBe(5);
    expect(mockWAClient.sendMessage).toHaveBeenCalledTimes(2);
  });

  test('creates default role when missing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ role_id: 2, role_name: 'operator' }] })
      .mockResolvedValueOnce({ rows: [{ dashboard_user_id: 'd1', status: false }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/dashboard-register')
      .send({ username: 'dash', password: 'pass', whatsapp: '0812-1234x', client_ids: ['c1'] });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM roles'),
      ['operator']
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO roles'),
      ['operator']
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining('INSERT INTO dashboard_user_clients'),
      [expect.any(String), 'c1']
    );
  });

  test('returns 400 when client_ids missing for operator', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ role_id: 1, role_name: 'operator' }] });

    const res = await request(app)
      .post('/api/auth/dashboard-register')
      .send({ username: 'dash', password: 'pass', whatsapp: '0812-1234x' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/minimal satu client harus dipilih/);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('returns 400 when whatsapp invalid', async () => {
    const res = await request(app)
      .post('/api/auth/dashboard-register')
      .send({ username: 'dash', password: 'pass', whatsapp: '123' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/whatsapp tidak valid/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns 400 when username exists', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ dashboard_user_id: 'x' }] });

    const res = await request(app)
      .post('/api/auth/dashboard-register')
      .send({ username: 'dash', password: 'pass', whatsapp: '0812-1234' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('POST /dashboard-login', () => {
  test('logs in dashboard user with correct password', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            dashboard_user_id: 'd1',
            username: 'dash',
            password_hash: await bcrypt.hash('pass', 10),
            role: 'admin',
            role_id: 2,
            status: true,
            client_ids: ['c1']
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ client_type: 'instansi' }] });

    const res = await request(app)
      .post('/api/auth/dashboard-login')
      .send({ username: 'dash', password: 'pass' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toEqual({
      dashboard_user_id: 'd1',
      role: 'admin',
      role_id: 2,
      client_ids: ['c1'],
      client_id: 'c1',
      premium_status: false,
      premium_tier: null,
      premium_expires_at: null
    });
    expect(mockRedis.sAdd).toHaveBeenCalledWith('dashboard_login:d1', res.body.token);
    expect(mockRedis.set).toHaveBeenCalledWith(
      `login_token:${res.body.token}`,
      'dashboard:d1',
      { EX: 2 * 60 * 60 }
    );
      expect(mockInsertLoginLog).toHaveBeenCalledWith({
      actorId: 'd1',
      loginType: 'operator',
      loginSource: 'web'
    });
    expect(mockGetPremiumSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ dashboard_user_id: 'd1' })
    );
  });

  test('sets role to client_id for direktorat client', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            dashboard_user_id: 'd1',
            username: 'dash',
            password_hash: await bcrypt.hash('pass', 10),
            role: 'admin',
            role_id: 2,
            status: true,
            client_ids: ['DIT1']
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ client_type: 'direktorat' }] });

    const res = await request(app)
      .post('/api/auth/dashboard-login')
      .send({ username: 'dash', password: 'pass' });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      dashboard_user_id: 'd1',
      role: 'dit1',
      role_id: 2,
      client_ids: ['DIT1'],
      client_id: 'DIT1',
      premium_status: false,
      premium_tier: null,
      premium_expires_at: null
    });
  });

  test('includes premium info from active subscription snapshot', async () => {
    mockGetPremiumSnapshot.mockResolvedValueOnce({
      premiumStatus: true,
      premiumTier: 'gold',
      premiumExpiresAt: '2025-01-01T00:00:00.000Z',
    });
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            dashboard_user_id: 'd1',
            username: 'dash',
            password_hash: await bcrypt.hash('pass', 10),
            role: 'admin',
            role_id: 2,
            status: true,
            client_ids: ['c1']
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ client_type: 'instansi' }] });

    const res = await request(app)
      .post('/api/auth/dashboard-login')
      .send({ username: 'dash', password: 'pass' });

    expect(res.status).toBe(200);
    expect(res.body.user.premium_status).toBe(true);
    expect(res.body.user.premium_tier).toBe('gold');
    expect(res.body.user.premium_expires_at).toBe('2025-01-01T00:00:00.000Z');
    const decoded = jwt.verify(res.body.token, 'testsecret');
    expect(decoded.premium_status).toBe(true);
    expect(decoded.premium_tier).toBe('gold');
  });

  test('keeps directorate client as role when client is DITSAMAPTA even if role is BIDHUMAS', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            dashboard_user_id: 'd1',
            username: 'dash',
            password_hash: await bcrypt.hash('pass', 10),
            role: 'BIDHUMAS',
            role_id: 2,
            status: true,
            client_ids: ['DITSAMAPTA']
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ client_type: 'direktorat' }] });

    const res = await request(app)
      .post('/api/auth/dashboard-login')
      .send({ username: 'dash', password: 'pass' });

    expect(res.status).toBe(200);
    expect(res.body.user.dashboard_user_id).toBe('d1');
    expect(res.body.user.role).toBe('ditsamapta');
    expect(res.body.user.client_ids).toEqual(['DITSAMAPTA']);
    expect(res.body.user.client_id).toBe('DITSAMAPTA');
    expect(res.body.user.premium_status).toBe(false);
    expect(res.body.user.premium_tier).toBeNull();
    const decoded = jwt.verify(res.body.token, 'testsecret');
    expect(decoded.role).toBe('ditsamapta');
    expect(decoded.client_id).toBe('DITSAMAPTA');
    expect(mockRedis.set).toHaveBeenCalledWith(
      `login_token:${res.body.token}`,
      'dashboard:d1',
      { EX: 2 * 60 * 60 }
    );
  });

  test('normalizes directorate client role to client_id when client is DITSAMAPTA', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            dashboard_user_id: 'd2',
            username: 'dash2',
            password_hash: await bcrypt.hash('pass', 10),
            role: 'bidhumas',
            role_id: 4,
            status: true,
            client_ids: ['ditsamapta']
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ client_type: 'direktorat' }] });

    const res = await request(app)
      .post('/api/auth/dashboard-login')
      .send({ username: 'dash2', password: 'pass' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('ditsamapta');
    expect(res.body.user.premium_status).toBe(false);
    const decoded = jwt.verify(res.body.token, 'testsecret');
    expect(decoded.role).toBe('ditsamapta');
  });

  test('returns 400 when operator has no allowed clients', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
            {
              dashboard_user_id: 'd1',
              username: 'dash',
              password_hash: await bcrypt.hash('pass', 10),
              role: 'admin',
              role_id: 2,
              status: true,
              client_ids: []
            }
        ]
      });

    const res = await request(app)
      .post('/api/auth/dashboard-login')
      .send({ username: 'dash', password: 'pass' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Operator belum memiliki klien yang diizinkan');
    expect(mockRedis.sAdd).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  test('returns 401 when password wrong', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
            {
              dashboard_user_id: 'd1',
              username: 'dash',
              password_hash: await bcrypt.hash('pass', 10),
              role: 'admin',
              role_id: 2,
              status: true,
              client_ids: ['c1']
            }
        ]
      });

    const res = await request(app)
      .post('/api/auth/dashboard-login')
      .send({ username: 'dash', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(mockRedis.sAdd).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});


describe('POST /user-login', () => {
  test('logs in user with correct whatsapp', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 'u1', nama: 'User' }]
    });

    const res = await request(app)
      .post('/api/auth/user-login')
      .send({ nrp: 'u1', whatsapp: '0808' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT user_id, nama FROM "user" WHERE user_id = $1 AND (whatsapp = $2 OR whatsapp = $3)',
      ['u1', '62808', '0808']
    );
    expect(mockRedis.sAdd).toHaveBeenCalledWith('user_login:u1', res.body.token);
    expect(mockRedis.set).toHaveBeenCalledWith(
      `login_token:${res.body.token}`,
      'user:u1',
      { EX: 2 * 60 * 60 }
    );
    expect(mockInsertLoginLog).toHaveBeenCalledWith({
      actorId: 'u1',
      loginType: 'user',
      loginSource: 'mobile'
    });
    expect(mockQueueAdminNotification).toHaveBeenCalledWith(
      expect.stringContaining('Login user: u1 - User')
    );
  });

  test('logs in user using password field', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 'u2', nama: 'User2' }]
    });

    const res = await request(app)
      .post('/api/auth/user-login')
      .send({ nrp: 'u2', password: '0812' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT user_id, nama FROM "user" WHERE user_id = $1 AND (whatsapp = $2 OR whatsapp = $3)',
      ['u2', '62812', '0812']
    );
    expect(mockRedis.sAdd).toHaveBeenCalledWith('user_login:u2', res.body.token);
    expect(mockRedis.set).toHaveBeenCalledWith(
      `login_token:${res.body.token}`,
      'user:u2',
      { EX: 2 * 60 * 60 }
    );
    expect(mockInsertLoginLog).toHaveBeenCalledWith({
      actorId: 'u2',
      loginType: 'user',
      loginSource: 'mobile'
    });
    expect(mockQueueAdminNotification).toHaveBeenCalledWith(
      expect.stringContaining('Login user: u2 - User2')
    );
  });
});

describe('POST /dashboard-password-reset/request', () => {
  test('creates reset request and sends WhatsApp message', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            dashboard_user_id: 'du1',
            username: 'operator',
            whatsapp: '628123456789',
            role: 'operator',
            client_ids: ['c1'],
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            reset_id: 'reset-1',
            dashboard_user_id: 'du1',
            reset_token: 'token-1',
          },
        ],
      });

    const res = await request(app)
      .post('/api/auth/dashboard-password-reset/request')
      .send({ username: 'operator', contact: '08123456789' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Instruksi reset password telah dikirim melalui WhatsApp.',
    });
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM dashboard_user du'),
      ['operator'],
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO dashboard_password_resets'),
      [
        'du1',
        '08123456789',
        expect.any(String),
        expect.any(Date),
      ],
    );
    expect(mockWAClient.sendMessage).toHaveBeenCalledTimes(1);
    const [wid, message, options] = mockWAClient.sendMessage.mock.calls[0];
    expect(wid).toBe('628123456789@c.us');
    expect(options).toEqual({});
    expect(message).toContain('Reset Password Dashboard');
    expect(message).toContain('https://papiqo.com/reset-password?token=');
    expect(message).toContain('Dengan url https://papiqo.com/reset-password');
    expect(message).toContain('Copy');
    expect(mockQueueAdminNotification).not.toHaveBeenCalled();
  });

  test('rejects when contact does not match stored whatsapp', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            dashboard_user_id: 'du1',
            username: 'operator',
            whatsapp: '628111111111',
            role: 'operator',
            client_ids: ['c1'],
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/dashboard-password-reset/request')
      .send({ username: 'operator', contact: '082233344455' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('kontak tidak sesuai dengan data pengguna');
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockWAClient.sendMessage).not.toHaveBeenCalled();
  });

  test.each([
    ['/api/auth/password-reset/request'],
    ['/api/password-reset/request'],
  ])('alias route %s returns the same response as dashboard endpoint', async (aliasPath) => {
    mockWAClient.sendMessage.mockResolvedValue(true);
    const userRow = {
      dashboard_user_id: 'du1',
      username: 'operator',
      whatsapp: '628123456789',
      role: 'operator',
      client_ids: ['c1'],
    };
    const resetRow = {
      reset_id: 'reset-1',
      dashboard_user_id: 'du1',
      reset_token: 'token-1',
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [userRow] })
      .mockResolvedValueOnce({ rows: [resetRow] })
      .mockResolvedValueOnce({ rows: [userRow] })
      .mockResolvedValueOnce({ rows: [resetRow] });

    const payload = { username: 'operator', contact: '08123456789' };

    const dashboardResponse = await request(app)
      .post('/api/auth/dashboard-password-reset/request')
      .send(payload);

    const aliasResponse = await request(app)
      .post(aliasPath)
      .send(payload);

    expect(aliasResponse.status).toBe(dashboardResponse.status);
    expect(aliasResponse.body).toEqual(dashboardResponse.body);
    expect(mockWAClient.sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe('POST /dashboard-password-reset/confirm', () => {
  test('returns error for unknown or expired token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/dashboard-password-reset/confirm')
      .send({ token: 'bad-token', password: 'Newpass123', confirmPassword: 'Newpass123' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: 'token reset tidak valid atau sudah kedaluwarsa',
    });
    expect(mockRedis.sMembers).not.toHaveBeenCalled();
  });

  test('updates password and clears sessions on success', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            reset_token: 'good-token',
            dashboard_user_id: 'du1',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            dashboard_user_id: 'du1',
            username: 'operator',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            reset_token: 'good-token',
            used_at: new Date().toISOString(),
          },
        ],
      });
    mockRedis.sMembers.mockResolvedValueOnce(['old-token']);

    const res = await request(app)
      .post('/api/auth/dashboard-password-reset/confirm')
      .send({ token: 'good-token', password: 'Newpass123', confirmPassword: 'Newpass123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Password berhasil diperbarui. Silakan login kembali.',
    });
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM dashboard_password_resets'),
      ['good-token'],
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE dashboard_user SET password_hash'),
      ['du1', expect.any(String)],
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE dashboard_password_resets'),
      ['good-token'],
    );
    expect(mockRedis.sMembers).toHaveBeenCalledWith('dashboard_login:du1');
    expect(mockRedis.del).toHaveBeenCalledWith('login_token:old-token');
    expect(mockRedis.del).toHaveBeenCalledWith('dashboard_login:du1');
  });

  test.each([
    ['/api/auth/password-reset/confirm'],
    ['/api/password-reset/confirm'],
  ])('alias confirm route %s mirrors dashboard response', async (aliasPath) => {
    const resetRecord = {
      reset_token: 'alias-token',
      dashboard_user_id: 'du1',
    };
    const updatedUser = {
      dashboard_user_id: 'du1',
      username: 'operator',
    };
    const usedRecord = {
      reset_token: 'alias-token',
      used_at: new Date().toISOString(),
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [resetRecord] })
      .mockResolvedValueOnce({ rows: [updatedUser] })
      .mockResolvedValueOnce({ rows: [usedRecord] })
      .mockResolvedValueOnce({ rows: [resetRecord] })
      .mockResolvedValueOnce({ rows: [updatedUser] })
      .mockResolvedValueOnce({ rows: [usedRecord] });
    mockRedis.sMembers
      .mockResolvedValueOnce(['old-token'])
      .mockResolvedValueOnce(['old-token-2']);

    const payload = {
      token: 'alias-token',
      password: 'Newpass123',
      confirmPassword: 'Newpass123',
    };

    const dashboardResponse = await request(app)
      .post('/api/auth/dashboard-password-reset/confirm')
      .send(payload);

    const aliasResponse = await request(app)
      .post(aliasPath)
      .send(payload);

    expect(aliasResponse.status).toBe(dashboardResponse.status);
    expect(aliasResponse.body).toEqual(dashboardResponse.body);
    expect(mockRedis.del).toHaveBeenCalledWith('dashboard_login:du1');
  });
});
