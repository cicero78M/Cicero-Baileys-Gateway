import { jest } from '@jest/globals';

let requestOtp;
let userModel;

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

beforeEach(async () => {
  jest.resetModules();
  jest.unstable_mockModule('../src/model/userModel.js', () => ({
    findUserById: jest.fn(),
  }));
  jest.unstable_mockModule('../src/service/otpService.js', () => ({
    generateOtp: jest.fn().mockReturnValue('123456'),
    verifyOtp: jest.fn(),
    isVerified: jest.fn(),
    refreshVerification: jest.fn(),
    clearVerification: jest.fn(),
  }));
  jest.unstable_mockModule('../src/service/otpQueue.js', () => ({
    enqueueOtp: jest.fn().mockResolvedValue(),
  }));
  ({ requestOtp } = await import('../src/controller/claimController.js'));
  userModel = await import('../src/model/userModel.js');
});

test('allows request when stored email matches after normalization', async () => {
  userModel.findUserById.mockResolvedValue({ user_id: '1', email: 'User@Example.com' });
  const req = { body: { nrp: '1', email: 'user@example.com ' } };
  const res = createRes();
  await requestOtp(req, res, () => {});
  expect(res.status).toHaveBeenCalledWith(202);
});

test('rejects request when stored email differs', async () => {
  userModel.findUserById.mockResolvedValue({ user_id: '1', email: 'user@example.com' });
  const req = { body: { nrp: '1', email: 'other@example.com' } };
  const res = createRes();
  await requestOtp(req, res, () => {});
  expect(res.status).toHaveBeenCalledWith(400);
});

test('returns 502 when enqueueOtp fails', async () => {
  userModel.findUserById.mockResolvedValue({ user_id: '1', email: 'user@example.com' });
  const req = { body: { nrp: '1', email: 'user@example.com' } };
  const res = createRes();
  const { enqueueOtp } = await import('../src/service/otpQueue.js');
  enqueueOtp.mockRejectedValue(new Error('queue fail'));
  await requestOtp(req, res, () => {});
  expect(res.status).toHaveBeenCalledWith(502);
  expect(res.json).toHaveBeenCalledWith({
    success: false,
    message: 'Gagal mengirim OTP',
  });
});

test('returns 503 when enqueueOtp fails with connection error', async () => {
  userModel.findUserById.mockResolvedValue({ user_id: '1', email: 'user@example.com' });
  const req = { body: { nrp: '1', email: 'user@example.com' } };
  const res = createRes();
  const { enqueueOtp } = await import('../src/service/otpQueue.js');
  const err = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
  enqueueOtp.mockRejectedValue(err);
  await requestOtp(req, res, () => {});
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({
    success: false,
    message: 'Gagal mengirim OTP',
  });
});

test('returns 503 when findUserById throws connection error', async () => {
  const err = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
  userModel.findUserById.mockRejectedValue(err);
  const req = { body: { nrp: '1', email: 'user@example.com' } };
  const res = createRes();
  await requestOtp(req, res, () => {});
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Database tidak tersedia' });
});
