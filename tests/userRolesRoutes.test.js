import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const mockUpdateUserRoleIds = jest.fn((req, res) => {
  res.status(200).json({ success: true });
});

jest.unstable_mockModule('../src/controller/userController.js', () => ({
  updateUserRoleIds: mockUpdateUserRoleIds
}));

let userRolesRoutes;

beforeAll(async () => {
  ({ default: userRolesRoutes } = await import('../src/routes/userRolesRoutes.js'));
});

beforeEach(() => {
  mockUpdateUserRoleIds.mockClear();
});

test('PUT /user_roles/update forwards to controller', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/user_roles', userRolesRoutes);

  const res = await request(app)
    .put('/api/user_roles/update')
    .send({ old_user_id: '1', new_user_id: '2' });

  expect(res.status).toBe(200);
  expect(mockUpdateUserRoleIds).toHaveBeenCalled();
});

test('POST /user_roles/update forwards to controller', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/user_roles', userRolesRoutes);

  const res = await request(app)
    .post('/api/user_roles/update')
    .send({ old_user_id: '1', new_user_id: '2' });

  expect(res.status).toBe(200);
  expect(mockUpdateUserRoleIds).toHaveBeenCalled();
});
