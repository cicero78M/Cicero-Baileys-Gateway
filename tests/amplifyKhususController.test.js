import { jest } from '@jest/globals';

const mockGetRekap = jest.fn();
jest.unstable_mockModule('../src/model/linkReportKhususModel.js', () => ({
  getRekapLinkByClient: mockGetRekap
}));
jest.unstable_mockModule('../src/middleware/debugHandler.js', () => ({
  sendConsoleDebug: jest.fn()
}));

let getAmplifyKhususRekap;
beforeAll(async () => {
  ({ getAmplifyKhususRekap } = await import('../src/controller/amplifyKhususController.js'));
});

beforeEach(() => {
  mockGetRekap.mockReset();
});

test('returns 403 when client_id unauthorized', async () => {
  const req = { query: { client_id: 'c2' }, user: { client_ids: ['c1'] } };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getAmplifyKhususRekap(req, res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(json).toHaveBeenCalledWith({ success: false, message: 'client_id tidak diizinkan' });
  expect(mockGetRekap).not.toHaveBeenCalled();
});

test('allows authorized client_id', async () => {
  mockGetRekap.mockResolvedValue([]);
  const req = { query: { client_id: 'c1' }, user: { client_ids: ['c1'] } };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getAmplifyKhususRekap(req, res);
  expect(res.status).not.toHaveBeenCalledWith(403);
  expect(mockGetRekap).toHaveBeenCalledWith('c1', 'harian', undefined, null, {});
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});

test('passes null roleFlag when scope and role not provided', async () => {
  mockGetRekap.mockResolvedValue([]);
  const req = { 
    query: { client_id: 'c1', periode: 'bulanan', tanggal: '2024-01' }, 
    user: { client_ids: ['c1'] } 
  };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getAmplifyKhususRekap(req, res);
  expect(mockGetRekap).toHaveBeenCalledWith('c1', 'bulanan', '2024-01', null, {});
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});

test('filters by operator role when scope is org', async () => {
  mockGetRekap.mockResolvedValue([]);
  const req = { 
    query: { client_id: 'c1', scope: 'org', role: 'operator' }, 
    user: { client_ids: ['c1'], client_id: 'c1' } 
  };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getAmplifyKhususRekap(req, res);
  expect(mockGetRekap).toHaveBeenCalledWith('c1', 'harian', undefined, 'operator', {
    userClientId: 'c1',
    userRoleFilter: 'operator'
  });
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});

test('returns 400 when role missing with scope', async () => {
  const req = { 
    query: { client_id: 'c1', scope: 'org' }, 
    user: { client_ids: ['c1'] } 
  };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getAmplifyKhususRekap(req, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(json).toHaveBeenCalledWith({ success: false, message: 'role wajib diisi' });
});

test('returns 400 when scope is invalid', async () => {
  const req = { 
    query: { client_id: 'c1', scope: 'invalid', role: 'operator' }, 
    user: { client_ids: ['c1'] } 
  };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getAmplifyKhususRekap(req, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(json).toHaveBeenCalledWith({ success: false, message: 'scope tidak valid' });
});
