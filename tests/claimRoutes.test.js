import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

function createRedisMock() {
  return {
    set: jest.fn().mockResolvedValue(),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(),
    ttl: jest.fn().mockResolvedValue(0),
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(),
    quit: jest.fn().mockResolvedValue(),
  };
}

describe('claim routes access', () => {
  let app;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'testsecret';
    await jest.isolateModulesAsync(async () => {
      jest.unstable_mockModule('../src/config/redis.js', () => ({
        default: createRedisMock(),
      }));
      jest.unstable_mockModule('../src/service/otpService.js', () => ({
        generateOtp: jest.fn().mockResolvedValue('123456'),
        verifyOtp: jest.fn().mockResolvedValue(true),
        isVerified: jest.fn().mockResolvedValue(true),
        refreshVerification: jest.fn().mockResolvedValue(),
        clearVerification: jest.fn().mockResolvedValue(),
      }));
      jest.unstable_mockModule('../src/model/userModel.js', () => ({
        findUserById: jest.fn().mockResolvedValue({ email: 'a@a.com' }),
        findUserByEmail: jest.fn().mockResolvedValue(null),
        updateUserField: jest.fn().mockResolvedValue(),
        updateUser: jest.fn().mockResolvedValue({ success: true }),
      }));
      jest.unstable_mockModule('../src/service/otpQueue.js', () => ({
        enqueueOtp: jest.fn().mockResolvedValue(),
      }));
      const claimMod = await import('../src/routes/claimRoutes.js');
      const claimRoutes = claimMod.default;
      const { authRequired } = await import('../src/middleware/authMiddleware.js');
      app = express();
      app.use(express.json());
      app.use('/api/claim', claimRoutes);
      const router = express.Router();
      router.get('/protected', (req, res) => res.json({ success: true }));
      app.use('/api', authRequired, router);
    });
  });

  afterAll(() => {
    jest.resetModules();
  });

  test('allows access without token', async () => {
    await request(app).post('/api/claim/request-otp').send({ nrp: '1', email: 'a@a.com' }).expect(202);
    await request(app)
      .post('/api/claim/verify-otp')
      .send({ nrp: '1', email: 'a@a.com', otp: '123' })
      .expect(200);
    await request(app).post('/api/claim/user-data').send({ nrp: '1', email: 'a@a.com' }).expect(200);
    await request(app).put('/api/claim/update').send({ nrp: '1', email: 'a@a.com' }).expect(200);
  });

  test('blocks other routes without token', async () => {
    const res = await request(app).get('/api/protected');
    expect(res.status).toBe(401);
    const token = jwt.sign({ user_id: 'u1', role: 'user' }, process.env.JWT_SECRET);
    const res2 = await request(app).get('/api/protected').set('Authorization', `Bearer ${token}`);
    expect(res2.status).toBe(200);
  });
});

describe('request otp conflict messaging', () => {
  let app;
  let userModelMocks;
  let otpServiceMocks;

  beforeEach(async () => {
    jest.resetModules();
    userModelMocks = {
      findUserById: jest.fn().mockResolvedValue(null),
      findUserByEmail: jest.fn().mockResolvedValue({ user_id: '2', email: 'used@example.com' }),
      updateUserField: jest.fn(),
      updateUser: jest.fn(),
    };
    otpServiceMocks = {
      generateOtp: jest.fn().mockResolvedValue('999000'),
      verifyOtp: jest.fn(),
      isVerified: jest.fn(),
      refreshVerification: jest.fn(),
      clearVerification: jest.fn(),
    };

    await jest.isolateModulesAsync(async () => {
      jest.unstable_mockModule('../src/config/redis.js', () => ({
        default: createRedisMock(),
      }));
      jest.unstable_mockModule('../src/service/otpService.js', () => otpServiceMocks);
      jest.unstable_mockModule('../src/model/userModel.js', () => userModelMocks);
      jest.unstable_mockModule('../src/service/otpQueue.js', () => ({
        enqueueOtp: jest.fn(),
      }));
      const claimMod = await import('../src/routes/claimRoutes.js');
      const claimRoutes = claimMod.default;
      app = express();
      app.use(express.json());
      app.use('/api/claim', claimRoutes);
    });
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('returns conflict when email already used by another account', async () => {
    const res = await request(app)
      .post('/api/claim/request-otp')
      .send({ nrp: '999', email: 'used@example.com' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      message:
        'Email sudah dipakai akun lain. Gunakan email berbeda atau hubungi admin untuk memperbaiki data.',
    });
    expect(userModelMocks.findUserByEmail).toHaveBeenCalled();
  });

  test('allows request when email belongs to same nrp even if lookup by id fails', async () => {
    userModelMocks.findUserByEmail.mockResolvedValue({ user_id: '999', email: 'used@example.com' });

    const res = await request(app)
      .post('/api/claim/request-otp')
      .send({ nrp: '999', email: 'used@example.com' });

    expect(res.status).toBe(202);
    expect(userModelMocks.findUserByEmail).toHaveBeenCalled();
    expect(otpServiceMocks.generateOtp).toHaveBeenCalledWith('999', 'used@example.com');
  });
});

describe('claim update validation', () => {
  let app;
  let serviceMocks;

  beforeEach(async () => {
    jest.resetModules();
    serviceMocks = {
      isVerified: jest.fn().mockResolvedValue(false),
      verifyOtp: jest.fn().mockResolvedValue(false),
      refreshVerification: jest.fn().mockResolvedValue(),
    };
    await jest.isolateModulesAsync(async () => {
      jest.unstable_mockModule('../src/config/redis.js', () => ({
        default: createRedisMock(),
      }));
      jest.unstable_mockModule('../src/service/otpService.js', () => ({
        generateOtp: jest.fn(),
        verifyOtp: serviceMocks.verifyOtp,
        isVerified: serviceMocks.isVerified,
        refreshVerification: serviceMocks.refreshVerification,
      }));
      jest.unstable_mockModule('../src/model/userModel.js', () => ({
        findUserById: jest.fn(),
        findUserByEmail: jest.fn(),
        updateUserField: jest.fn(),
        updateUser: jest.fn().mockResolvedValue({ success: true }),
      }));
      jest.unstable_mockModule('../src/service/otpQueue.js', () => ({
        enqueueOtp: jest.fn(),
      }));
      const claimMod = await import('../src/routes/claimRoutes.js');
      const claimRoutes = claimMod.default;
      app = express();
      app.use(express.json());
      app.use('/api/claim', claimRoutes);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('returns 400 when instagram format invalid', async () => {
    const res = await request(app)
      .put('/api/claim/update')
      .send({ nrp: '1', email: 'a@a.com', insta: 'not a handle' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message:
        'Format username Instagram tidak valid. Gunakan tautan profil atau username seperti instagram.com/username atau @username.',
    });
    expect(serviceMocks.isVerified).not.toHaveBeenCalled();
    expect(serviceMocks.verifyOtp).not.toHaveBeenCalled();
  });

  test('returns 400 when tiktok format invalid', async () => {
    const res = await request(app)
      .put('/api/claim/update')
      .send({ nrp: '1', email: 'a@a.com', tiktok: 'tiktok.com/user' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message:
        'Format username TikTok tidak valid. Gunakan tautan profil atau username seperti tiktok.com/@username atau @username.',
    });
    expect(serviceMocks.isVerified).not.toHaveBeenCalled();
    expect(serviceMocks.verifyOtp).not.toHaveBeenCalled();
  });
});

describe('claim update verification ttl', () => {
  let app;
  let redisStore;
  let serviceMocks;
  let ttlMs;
  const VERIFY_TTL_MS = 10 * 60 * 1000;

  const normalizeId = (nrp) => String(nrp ?? '').trim().replace(/[^0-9]/g, '');
  const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers({ now: new Date('2024-01-01T00:00:00Z') });
    redisStore = new Map();
    serviceMocks = {
      generateOtp: jest.fn(),
      verifyOtp: jest.fn(async (nrp, email) => {
        const key = normalizeId(nrp);
        const normalizedEmail = normalizeEmail(email);
        if (!key || !normalizedEmail) return false;
        redisStore.set(`verified:${key}`, {
          value: normalizedEmail,
          expiresAt: Date.now() + VERIFY_TTL_MS,
        });
        return true;
      }),
      isVerified: jest.fn(async (nrp, email) => {
        const key = normalizeId(nrp);
        const entry = redisStore.get(`verified:${key}`);
        if (!entry) return false;
        if (entry.expiresAt && entry.expiresAt <= Date.now()) {
          redisStore.delete(`verified:${key}`);
          return false;
        }
        return entry.value === normalizeEmail(email);
      }),
      refreshVerification: jest.fn(async (nrp, email) => {
        const key = normalizeId(nrp);
        const current = redisStore.get(`verified:${key}`);
        const normalizedEmail =
          email && String(email).trim() !== ''
            ? normalizeEmail(email)
            : current?.value;
        if (!key || !normalizedEmail) return;
        redisStore.set(`verified:${key}`, {
          value: normalizedEmail,
          expiresAt: Date.now() + VERIFY_TTL_MS,
        });
      }),
      clearVerification: jest.fn(async (nrp) => {
        const key = normalizeId(nrp);
        redisStore.delete(`verified:${key}`);
      }),
    };

    await jest.isolateModulesAsync(async () => {
      jest.unstable_mockModule('../src/service/otpService.js', () => serviceMocks);
      jest.unstable_mockModule('../src/model/userModel.js', () => ({
        findUserById: jest.fn().mockResolvedValue({ email: 'a@a.com' }),
        findUserByEmail: jest.fn(),
        updateUserField: jest.fn(),
        updateUser: jest.fn().mockResolvedValue({ success: true }),
      }));
      jest.unstable_mockModule('../src/service/otpQueue.js', () => ({
        enqueueOtp: jest.fn(),
      }));
      const claimMod = await import('../src/routes/claimRoutes.js');
      app = express();
      app.use(express.json());
      app.use('/api/claim', claimMod.default);
    });

    await serviceMocks.refreshVerification('1', 'a@a.com');
    const seeded = redisStore.get('verified:1');
    if (!seeded) {
      throw new Error('Failed to seed verification state');
    }
    ttlMs = VERIFY_TTL_MS;
    redisStore.set('verified:1', {
      value: seeded.value,
      expiresAt: Date.now() + Math.floor(ttlMs / 2),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('allows repeated updates within verification ttl and expires afterwards', async () => {
    const firstEntry = redisStore.get('verified:1');
    const firstExpiry = firstEntry?.expiresAt ?? 0;

    const firstRes = await request(app)
      .put('/api/claim/update')
      .send({ nrp: '1', email: 'a@a.com' });
    expect(firstRes.status).toBe(200);
    const afterFirst = redisStore.get('verified:1');
    expect(afterFirst?.expiresAt).toBeGreaterThan(firstExpiry);

    jest.advanceTimersByTime(Math.floor(ttlMs / 2));
    const secondRes = await request(app)
      .put('/api/claim/update')
      .send({ nrp: '1', email: 'a@a.com' });
    expect(secondRes.status).toBe(200);
    const afterSecond = redisStore.get('verified:1');
    expect(afterSecond?.expiresAt).toBeGreaterThan(afterFirst?.expiresAt ?? 0);

    jest.advanceTimersByTime(ttlMs + 1000);
    const thirdRes = await request(app)
      .put('/api/claim/update')
      .send({ nrp: '1', email: 'a@a.com' });
    expect(thirdRes.status).toBe(403);
    expect(thirdRes.body).toEqual({ success: false, message: 'OTP belum diverifikasi' });

    await serviceMocks.refreshVerification('1', 'a@a.com');
    const fourthRes = await request(app)
      .put('/api/claim/update')
      .send({ nrp: '1', email: 'a@a.com' });
    expect(fourthRes.status).toBe(200);

    await serviceMocks.clearVerification('1');
    const fifthRes = await request(app)
      .put('/api/claim/update')
      .send({ nrp: '1', email: 'a@a.com' });
    expect(fifthRes.status).toBe(403);
    expect(fifthRes.body).toEqual({ success: false, message: 'OTP belum diverifikasi' });
  });
});
