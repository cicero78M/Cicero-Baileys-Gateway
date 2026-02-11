import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { authRequired } from '../src/middleware/authMiddleware.js';

// Mock the controllers
const mockGetAmplifyRekap = jest.fn((req, res) => res.json({ success: true, data: [] }));
const mockGetAmplifyKhususRekap = jest.fn((req, res) => res.json({ success: true, data: [] }));

jest.unstable_mockModule('../src/controller/amplifyController.js', () => ({
  getAmplifyRekap: mockGetAmplifyRekap
}));

jest.unstable_mockModule('../src/controller/amplifyKhususController.js', () => ({
  getAmplifyKhususRekap: mockGetAmplifyKhususRekap
}));

let amplifyRoutes;

beforeAll(async () => {
  amplifyRoutes = (await import('../src/routes/amplifyRoutes.js')).default;
});

describe('amplifyRoutes', () => {
  let app;

  beforeAll(() => {
    process.env.JWT_SECRET = 'testsecret';
    app = express();
    const router = express.Router();
    // Mount amplify routes at the amplify path, like in the actual app
    router.use('/amplify', amplifyRoutes);
    app.use('/api', authRequired, router);
  });

  beforeEach(() => {
    mockGetAmplifyRekap.mockClear();
    mockGetAmplifyKhususRekap.mockClear();
  });

  test('GET /api/amplify/rekap calls getAmplifyRekap', async () => {
    const token = jwt.sign({ user_id: 'u1', role: 'user' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/amplify/rekap?client_id=TEST')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGetAmplifyRekap).toHaveBeenCalled();
  });

  test('GET /api/amplify/rekap-khusus calls getAmplifyKhususRekap', async () => {
    const token = jwt.sign({ user_id: 'u1', role: 'user' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/amplify/rekap-khusus?client_id=TEST')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGetAmplifyKhususRekap).toHaveBeenCalled();
  });

  test('operator role can access /api/amplify/rekap', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/amplify/rekap?client_id=TEST')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('operator role can access /api/amplify/rekap-khusus', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/amplify/rekap-khusus?client_id=TEST')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
