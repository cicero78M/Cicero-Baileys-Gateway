import { jest } from '@jest/globals';

let verifyOtpController;
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
    updateUserField: jest.fn(),
  }));
  jest.unstable_mockModule('../src/service/otpService.js', () => ({
    generateOtp: jest.fn(),
    verifyOtp: jest.fn().mockReturnValue(true),
    isVerified: jest.fn(),
    refreshVerification: jest.fn(),
    clearVerification: jest.fn(),
  }));
  jest.unstable_mockModule('../src/service/otpQueue.js', () => ({
    enqueueOtp: jest.fn(),
  }));
  ({ verifyOtpController } = await import('../src/controller/claimController.js'));
  userModel = await import('../src/model/userModel.js');
});

test('returns 503 when findUserById throws connection error', async () => {
  const err = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
  userModel.findUserById.mockRejectedValue(err);
  const req = { body: { nrp: '1', email: 'user@example.com', otp: '123456' } };
  const res = createRes();
  await verifyOtpController(req, res, () => {});
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Database tidak tersedia' });
});

test('returns 404 when user not found after OTP verification', async () => {
  userModel.findUserById.mockResolvedValue(null);
  const req = { body: { nrp: '1', email: 'user@example.com', otp: '123456' } };
  const res = createRes();
  await verifyOtpController(req, res, () => {});
  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledWith({ success: false, message: 'User tidak ditemukan' });
  expect(userModel.updateUserField).not.toHaveBeenCalled();
});
