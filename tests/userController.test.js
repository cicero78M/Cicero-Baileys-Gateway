import { jest } from '@jest/globals';

const mockCreateUser = jest.fn();
const mockFindUserById = jest.fn();
const mockUpdateUserField = jest.fn();
const mockUpdateUser = jest.fn();
const mockGetUsersByClient = jest.fn();
const mockGetUsersByClientAndRole = jest.fn();
const mockGetUsersByDirektorat = jest.fn();
const mockFindClientById = jest.fn();
const mockUpdateUserRolesUserId = jest.fn();

jest.unstable_mockModule('../src/model/userModel.js', () => ({
  createUser: mockCreateUser,
  findUserById: mockFindUserById,
  updateUserField: mockUpdateUserField,
  updateUser: mockUpdateUser,
  getUsersByClient: mockGetUsersByClient,
  getUsersByClientAndRole: mockGetUsersByClientAndRole,
  getUsersByDirektorat: mockGetUsersByDirektorat,
  updateUserRolesUserId: mockUpdateUserRolesUserId
}));

jest.unstable_mockModule('../src/service/clientService.js', () => ({
  findClientById: mockFindClientById
}));

let createUser;
let getUserList;
let getUsersByClientCtrl;
let updateUserRolesCtrl;
let updateUserRoleIdsCtrl;

beforeAll(async () => {
  const mod = await import('../src/controller/userController.js');
  createUser = mod.createUser;
  getUserList = mod.getUserList;
  getUsersByClientCtrl = mod.getUsersByClient;
  updateUserRolesCtrl = mod.updateUserRoles;
  updateUserRoleIdsCtrl = mod.updateUserRoleIds;
});

beforeEach(() => {
  mockCreateUser.mockReset();
  mockFindUserById.mockReset();
  mockUpdateUserField.mockReset();
  mockUpdateUser.mockReset();
  mockGetUsersByClient.mockReset();
  mockGetUsersByClientAndRole.mockReset();
  mockGetUsersByDirektorat.mockReset();
  mockFindClientById.mockReset();
  mockUpdateUserRolesUserId.mockReset();
});

test('operator adds user with defaults', async () => {
  mockCreateUser.mockResolvedValue({ user_id: '1' });
  const req = { body: { user_id: '1', nama: 'A' }, user: { role: 'operator', client_id: 'c1' } };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockCreateUser).toHaveBeenCalledWith({
    user_id: '1',
    nama: 'A',
    ditbinmas: false,
    ditlantas: false,
    bidhumas: false,
    ditsamapta: false,
    ditintelkam: false,
    operator: true,
  });
  expect(status).toHaveBeenCalledWith(201);
  expect(json).toHaveBeenCalledWith({ success: true, data: { user_id: '1' } });
});

test('operator assigns ditbinmas role when specified', async () => {
  mockCreateUser.mockResolvedValue({ user_id: '3' });
  const req = {
    body: { user_id: '3', nama: 'C', roles: ['ditbinmas'] },
    user: { role: 'operator', client_id: 'c1' }
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockCreateUser).toHaveBeenCalledWith({
    user_id: '3',
    nama: 'C',
    ditbinmas: true,
  });
  expect(mockCreateUser.mock.calls[0][0].operator).toBeUndefined();
  expect(status).toHaveBeenCalledWith(201);
  expect(json).toHaveBeenCalledWith({ success: true, data: { user_id: '3' } });
});

test('operator assigns multiple roles simultaneously', async () => {
  mockCreateUser.mockResolvedValue({ user_id: '4' });
  const req = {
    body: { user_id: '4', nama: 'D', roles: ['operator', 'ditbinmas'] },
    user: { role: 'operator', client_id: 'c1' }
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockCreateUser).toHaveBeenCalledWith({
    user_id: '4',
    nama: 'D',
    operator: true,
    ditbinmas: true,
    ditlantas: false,
    bidhumas: false,
    ditsamapta: false,
    ditintelkam: false,
  });
  expect(status).toHaveBeenCalledWith(201);
});

test('operator reactivates existing user and attaches operator role', async () => {
  mockFindUserById
    .mockResolvedValueOnce({ user_id: '1', status: false })
    .mockResolvedValueOnce({ user_id: '1', status: true, operator: true, nama: 'A' });
  const req = { body: { user_id: '1', nama: 'A' }, user: { role: 'operator', client_id: 'c1' } };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockFindUserById).toHaveBeenCalledWith('1');
  expect(mockUpdateUser).toHaveBeenCalledWith('1', {
    status: true,
    ditbinmas: false,
    ditlantas: false,
    bidhumas: false,
    ditsamapta: false,
    ditintelkam: false,
    operator: true
  });
  expect(mockUpdateUserField).not.toHaveBeenCalled();
  expect(mockCreateUser).not.toHaveBeenCalled();
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({
    success: true,
    data: { user_id: '1', status: true, operator: true, nama: 'A' }
  });
});

test('operator reactivates existing user with multiple roles', async () => {
  mockFindUserById
    .mockResolvedValueOnce({ user_id: '5', status: false })
    .mockResolvedValueOnce({
      user_id: '5',
      status: true,
      operator: true,
      ditbinmas: true,
      nama: 'E'
    });
  const req = {
    body: { user_id: '5', nama: 'E', roles: ['operator', 'ditbinmas'] },
    user: { role: 'operator', client_id: 'c1' }
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockFindUserById).toHaveBeenCalledWith('5');
  expect(mockUpdateUser).toHaveBeenCalledWith('5', {
    status: true,
    ditbinmas: false,
    ditlantas: false,
    bidhumas: false,
    ditsamapta: false,
    ditintelkam: false,
    operator: true
  });
  expect(mockUpdateUserField).not.toHaveBeenCalled();
  expect(mockCreateUser).not.toHaveBeenCalled();
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({
    success: true,
    data: {
      user_id: '5',
      status: true,
      operator: true,
      ditbinmas: true,
      nama: 'E'
    }
  });
});

test('updateUserRoles updates roles based on array', async () => {
  mockUpdateUser.mockResolvedValue({
    user_id: '1',
    operator: true,
    ditbinmas: true,
    ditlantas: false,
    bidhumas: false,
    ditsamapta: false,
    ditintelkam: false,
  });
  const req = { params: { id: '1' }, body: { roles: ['operator', 'ditbinmas'] } };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await updateUserRolesCtrl(req, res, () => {});

  expect(mockUpdateUser).toHaveBeenCalledWith('1', {
    operator: true,
    ditbinmas: true,
    ditlantas: false,
    bidhumas: false,
    ditsamapta: false,
    ditintelkam: false,
  });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        user_id: '1',
        operator: true,
        ditbinmas: true,
        ditlantas: false,
        bidhumas: false,
        ditsamapta: false,
        ditintelkam: false,
      },
    });
  });

test('updateUserRoleIds updates user_roles mapping', async () => {
  const req = { body: { old_user_id: '1', new_user_id: '2' } };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await updateUserRoleIdsCtrl(req, res, () => {});

  expect(mockUpdateUserRolesUserId).toHaveBeenCalledWith('1', '2');
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({
    success: true,
    data: { old_user_id: '1', new_user_id: '2' }
  });
});

test('reactivates existing user and attaches ditbinmas role', async () => {
  mockFindUserById
    .mockResolvedValueOnce({ user_id: '1', status: false })
    .mockResolvedValueOnce({ user_id: '1', status: true, ditbinmas: true, nama: 'B', operator: false });
  const req = { body: { user_id: '1', nama: 'B' }, user: { role: 'ditbinmas', client_id: 'c2' } };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockUpdateUser).toHaveBeenCalledWith('1', {
    status: true,
    ditbinmas: true,
    ditlantas: false,
    bidhumas: false,
    ditsamapta: false,
    ditintelkam: false,
    operator: false
  });
  expect(mockUpdateUserField).not.toHaveBeenCalled();
  expect(mockCreateUser).not.toHaveBeenCalled();
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({
    success: true,
    data: { user_id: '1', status: true, ditbinmas: true, nama: 'B', operator: false }
  });
});

test('keeps existing roles when adding new role to active user', async () => {
  mockFindUserById
    .mockResolvedValueOnce({ user_id: '9', status: true, operator: true })
    .mockResolvedValueOnce({ user_id: '9', status: true, operator: true, ditlantas: true });
  const req = {
    body: { user_id: '9', nama: 'F', roles: ['ditlantas'] },
    user: { role: 'operator', client_id: 'c1' }
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockUpdateUserField).toHaveBeenCalledWith('9', 'ditlantas', true);
  expect(mockUpdateUser).not.toHaveBeenCalled();
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({
    success: true,
    data: { user_id: '9', status: true, operator: true, ditlantas: true }
  });
});

test('ditlantas creates new user with flag', async () => {
  mockFindUserById.mockResolvedValue(null);
  mockCreateUser.mockResolvedValue({ user_id: '2', ditlantas: true, client_id: 'c2' });
  const req = { body: { user_id: '2', nama: 'B' }, user: { role: 'ditlantas', client_id: 'c2' } };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockCreateUser).toHaveBeenCalledWith(
    expect.objectContaining({
      user_id: '2',
      nama: 'B',
      client_id: 'c2',
      ditlantas: true,
    })
  );
  expect(status).toHaveBeenCalledWith(201);
});

test('ditintelkam creates new user with flag', async () => {
  mockFindUserById.mockResolvedValue(null);
  mockCreateUser.mockResolvedValue({ user_id: '10', ditintelkam: true, client_id: 'DITINTELKAM' });
  const req = { body: { user_id: '10', nama: 'Test User' }, user: { role: 'ditintelkam', client_id: 'DITINTELKAM' } };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockCreateUser).toHaveBeenCalledWith(
    expect.objectContaining({
      user_id: '10',
      nama: 'Test User',
      client_id: 'DITINTELKAM',
      ditintelkam: true,
    })
  );
  expect(status).toHaveBeenCalledWith(201);
});

test('ditbinmas role with matching client_id shows all users', async () => {
  mockFindClientById.mockResolvedValue({ client_type: 'direktorat' });
  mockGetUsersByDirektorat.mockResolvedValue([{ user_id: '1', ditbinmas: true }]);
  const req = {
    user: { role: 'ditbinmas', client_id: 'DITBINMAS' },
    query: { client_id: 'ditbinmas' }
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await getUserList(req, res, () => {});

  expect(mockFindClientById).not.toHaveBeenCalled();
  expect(mockGetUsersByDirektorat).toHaveBeenCalledWith('ditbinmas');
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({ success: true, data: [{ user_id: '1', ditbinmas: true }] });
});

test('ditbinmas role with different client_id filters users by client', async () => {
  mockFindClientById.mockResolvedValue({ client_type: 'direktorat' });
  mockGetUsersByDirektorat.mockResolvedValue([{ user_id: '2', ditbinmas: true }]);
  const req = {
    user: { role: 'ditbinmas', client_id: 'c1' },
    query: { client_id: 'ditbinmas' }
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await getUserList(req, res, () => {});

  expect(mockFindClientById).not.toHaveBeenCalled();
  expect(mockGetUsersByDirektorat).toHaveBeenCalledWith('ditbinmas', 'c1');
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({ success: true, data: [{ user_id: '2', ditbinmas: true }] });
});

test('ditsamapta client routes to direktorate handler with token client filter', async () => {
  mockGetUsersByDirektorat.mockResolvedValue([{ user_id: '4', ditsamapta: true }]);
  const req = {
    user: { role: 'admin', client_id: 'ORG1' },
    query: { client_id: 'DITSAMAPTA' }
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await getUserList(req, res, () => {});

  expect(mockFindClientById).not.toHaveBeenCalled();
  expect(mockGetUsersByDirektorat).toHaveBeenCalledWith('ditsamapta', 'ORG1');
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({ success: true, data: [{ user_id: '4', ditsamapta: true }] });
});

test('non-operator role with org client uses client id and role', async () => {
  mockFindClientById.mockResolvedValue({ client_type: 'org' });
  mockGetUsersByClient.mockResolvedValue([{ user_id: '3' }]);
  const req = { user: { role: 'admin' }, query: { client_id: 'c2' } };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await getUserList(req, res, () => {});

  expect(mockFindClientById).toHaveBeenCalledWith('c2');
  expect(mockGetUsersByClient).toHaveBeenCalledWith('c2', 'admin');
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({ success: true, data: [{ user_id: '3' }] });
});

test('getUsersByClient uses token client and role for ditbinmas', async () => {
  mockGetUsersByClient.mockResolvedValue([{ user_id: '1' }]);
  const req = { params: { client_id: 'other' }, user: { role: 'ditbinmas', client_id: 'C1' } };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await getUsersByClientCtrl(req, res, () => {});

  expect(mockGetUsersByClient).toHaveBeenCalledWith('C1', 'ditbinmas');
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({ success: true, data: [{ user_id: '1' }] });
});
