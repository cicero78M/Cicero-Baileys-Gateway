import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

describe('dedupRequest middleware', () => {
  let app;
  let redisMock;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'testsecret';
    jest.resetModules();

    redisMock = {
      exists: jest.fn(),
      set: jest.fn(),
      on: jest.fn(),
      connect: jest.fn()
    };

    jest.unstable_mockModule('../src/config/redis.js', () => ({
      default: redisMock
    }));

    const { dedupRequest } = await import('../src/middleware/dedupRequestMiddleware.js');

    app = express();
    app.use(express.json());
    app.use(dedupRequest);
    app.post('/api/claim/test', (req, res) => res.status(200).json({ ok: true }));
    app.post('/api/other', (req, res) => res.status(200).json({ ok: true }));
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('allows repeated requests for claim routes', async () => {
    const first = await request(app)
      .post('/api/claim/test')
      .send({ foo: 'bar' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/claim/test')
      .send({ foo: 'bar' });
    expect(second.status).toBe(200);

    expect(redisMock.exists).not.toHaveBeenCalled();
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  test('still blocks duplicate requests on other routes', async () => {
    redisMock.exists.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const first = await request(app)
      .post('/api/other')
      .send({ foo: 'bar' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/other')
      .send({ foo: 'bar' });
    expect(second.status).toBe(429);

    expect(redisMock.exists).toHaveBeenCalledTimes(2);
  });
});
