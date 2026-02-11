import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { authRequired } from '../src/middleware/authMiddleware.js';

describe('authRequired middleware', () => {
  let app;

  beforeAll(() => {
    process.env.JWT_SECRET = 'testsecret';
    app = express();
    app.use(express.json());
    const router = express.Router();
    router.get('/claim/ok', (req, res) => res.json({ success: true }));
    router.get('/clients/data', (req, res) => res.json({ success: true }));
    router.get('/clients/profile', (req, res) => res.json({ success: true }));
    router.get('/aggregator', (req, res) => res.json({ success: true }));
    router.post('/aggregator/refresh', (req, res) => res.json({ success: true }));
    router.get('/users/list', (req, res) => res.json({ success: true }));
    router.post('/users/list', (req, res) => res.json({ success: true }));
    router.get('/dashboard/stats', (req, res) => res.json({ success: true }));
    router.get('/dashboard/login-web/recap', (req, res) => res.json({ success: true }));
    router.post('/dashboard/komplain/insta', (req, res) => res.json({ success: true }));
    router.post('/dashboard/komplain/tiktok', (req, res) => res.json({ success: true }));
    router.get('/amplify/rekap', (req, res) => res.json({ success: true }));
    router.get('/amplify/rekap-khusus', (req, res) => res.json({ success: true }));
    router.get('/amplify-khusus/rekap', (req, res) => res.json({ success: true }));
    router.post('/link-reports', (req, res) => res.json({ success: true }));
    router.post('/link-reports-khusus', (req, res) => res.json({ success: true }));
    router.put('/link-reports/abc123', (req, res) => res.json({ success: true }));
    router.put('/link-reports-khusus/xyz789', (req, res) => res.json({ success: true }));
    router.get('/other', (req, res) => res.json({ success: true }));
    app.use('/api', authRequired, router);
  });

  test('blocks operator role on claim routes when protected by authRequired', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/claim/ok')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('allows operator role on client profile route', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/clients/profile')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('allows operator role on user directory route', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/users/list')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('allows operator role on dashboard stats route', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('allows operator role on dashboard login recap route', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/dashboard/login-web/recap')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('allows operator role on aggregator route', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/aggregator')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('allows operator role on amplify rekap route', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/amplify/rekap')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('allows operator role on amplify khusus rekap route', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/amplify-khusus/rekap')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('allows operator role on amplify rekap-khusus route', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/amplify/rekap-khusus')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('allows operator role to POST link-reports', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .post('/api/link-reports')
      .set('Authorization', `Bearer ${token}`)
      .send({ shortcode: 'abc123', user_id: 'o1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('allows operator role to POST link-reports-khusus', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .post('/api/link-reports-khusus')
      .set('Authorization', `Bearer ${token}`)
      .send({ shortcode: 'xyz789', user_id: 'o1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('allows operator role to PUT link-reports', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .put('/api/link-reports/abc123')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: 'o1', instagram_link: 'https://instagram.com/p/abc123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('allows operator role to PUT link-reports-khusus', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .put('/api/link-reports-khusus/xyz789')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: 'o1', instagram_link: 'https://instagram.com/p/xyz789' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('allows operator role on dashboard complaint Instagram route', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .post('/api/dashboard/komplain/insta')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('allows operator role on dashboard complaint TikTok route', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .post('/api/dashboard/komplain/tiktok')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('blocks operator role on disallowed methods', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .post('/api/users/list')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('allows user role on client routes', async () => {
    const token = jwt.sign({ user_id: 'u1', role: 'user' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/clients/data')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('blocks operator role on unauthorized routes', async () => {
    const token = jwt.sign({ user_id: 'o1', role: 'operator' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/other')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('allows user role on non-claim routes', async () => {
    const token = jwt.sign({ user_id: 'u1', role: 'user' }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/other')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
