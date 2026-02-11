import { jest } from '@jest/globals';

let updateUserData;
let userModel;
let otpService;

describe('updateUserData', () => {
  beforeEach(async () => {
    jest.resetModules();
    jest.unstable_mockModule('../src/model/userModel.js', () => ({
      updateUser: jest.fn().mockResolvedValue({ ok: true }),
      findUserById: jest.fn(),
      updateUserField: jest.fn()
    }));
    jest.unstable_mockModule('../src/service/otpService.js', () => ({
      isVerified: () => true,
      refreshVerification: jest.fn(),
      clearVerification: jest.fn(),
      generateOtp: jest.fn(),
      verifyOtp: jest.fn()
    }));
    jest.unstable_mockModule('../src/service/otpQueue.js', () => ({
      enqueueOtp: jest.fn(),
    }));
    ({ updateUserData } = await import('../src/controller/claimController.js'));
    userModel = await import('../src/model/userModel.js');
    otpService = await import('../src/service/otpService.js');
  });

  function createRes() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
  }

  test('extracts usernames from links', async () => {
    const req = {
      body: {
        nrp: '1',
        email: 'user@example.com',
        insta: 'https://www.instagram.com/de_saputra88?igsh=MWJxMnY1YmtnZ3Rmeg==',
        tiktok: 'https://www.tiktok.com/@sidik.prayitno37?_t=ZS-8zPPyl5Q4SO&_r=1'
      }
    };
    const res = createRes();
    await updateUserData(req, res, () => {});
    expect(userModel.updateUser).toHaveBeenCalledWith('1', expect.objectContaining({
      insta: 'de_saputra88',
      tiktok: '@sidik.prayitno37'
    }));
    expect(otpService.refreshVerification).toHaveBeenCalledWith('1', 'user@example.com');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('rejects instagram cicero_devs', async () => {
    const req = {
      body: {
        nrp: '1',
        email: 'user@example.com',
        insta: 'cicero_devs'
      }
    };
    const res = createRes();
    await updateUserData(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(userModel.updateUser).not.toHaveBeenCalled();
  });

  test('rejects tiktok cicero_devs', async () => {
    const req = {
      body: {
        nrp: '1',
        email: 'user@example.com',
        tiktok: 'cicero_devs'
      }
    };
    const res = createRes();
    await updateUserData(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(userModel.updateUser).not.toHaveBeenCalled();
  });

  test('allows empty tiktok without error', async () => {
    const req = {
      body: {
        nrp: '1',
        email: 'user@example.com',
        tiktok: ''
      }
    };
    const res = createRes();
    await updateUserData(req, res, () => {});
    const [, data] = userModel.updateUser.mock.calls[0];
    expect(data.tiktok).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(otpService.refreshVerification).toHaveBeenCalledWith('1', 'user@example.com');
  });

  test('returns 404 when user to update is not found', async () => {
    userModel.updateUser.mockResolvedValue(null);
    const req = {
      body: {
        nrp: '999999',
        email: 'missing@example.com',
        nama: 'Ghost User'
      }
    };
    const res = createRes();
    await updateUserData(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'User tidak ditemukan'
    });
    expect(otpService.refreshVerification).not.toHaveBeenCalled();
  });

  test('verifies otp when provided', async () => {
    jest.resetModules();
    jest.unstable_mockModule('../src/model/userModel.js', () => ({
      updateUser: jest.fn().mockResolvedValue({ ok: true }),
      findUserById: jest.fn(),
      updateUserField: jest.fn()
    }));
    jest.unstable_mockModule('../src/service/otpService.js', () => ({
      isVerified: jest.fn().mockResolvedValue(false),
      refreshVerification: jest.fn(),
      generateOtp: jest.fn(),
      verifyOtp: jest.fn().mockResolvedValue(true)
    }));
    jest.unstable_mockModule('../src/service/otpQueue.js', () => ({
      enqueueOtp: jest.fn(),
    }));
    ({ updateUserData } = await import('../src/controller/claimController.js'));
    userModel = await import('../src/model/userModel.js');
    otpService = await import('../src/service/otpService.js');
    const req = { body: { nrp: '1', email: 'user@example.com', otp: '123456' } };
    const res = createRes();
    await updateUserData(req, res, () => {});
    expect(otpService.verifyOtp).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(otpService.refreshVerification).toHaveBeenCalledWith('1', 'user@example.com');
  });

  test('returns success when refreshing verification fails', async () => {
    const req = {
      body: {
        nrp: '1',
        email: 'user@example.com'
      }
    };
    const res = createRes();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    otpService.refreshVerification.mockRejectedValueOnce(new Error('Redis down'));

    await updateUserData(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('normalizes and validates whatsapp number', async () => {
    const req = {
      body: {
        nrp: '1',
        email: 'user@example.com',
        whatsapp: '081234567890'
      }
    };
    const res = createRes();
    await updateUserData(req, res, () => {});
    expect(userModel.updateUser).toHaveBeenCalledWith('1', expect.objectContaining({
      whatsapp: '6281234567890'
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('rejects invalid whatsapp number with too few digits', async () => {
    const req = {
      body: {
        nrp: '1',
        email: 'user@example.com',
        whatsapp: '123'
      }
    };
    const res = createRes();
    await updateUserData(req, res, () => {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Nomor telepon tidak valid. Masukkan minimal 8 digit angka.'
    });
    expect(userModel.updateUser).not.toHaveBeenCalled();
  });

  test('allows empty whatsapp number', async () => {
    const req = {
      body: {
        nrp: '1',
        email: 'user@example.com',
        whatsapp: ''
      }
    };
    const res = createRes();
    await updateUserData(req, res, () => {});
    expect(userModel.updateUser).toHaveBeenCalledWith('1', expect.objectContaining({
      whatsapp: ''
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('accepts phone number with formatting characters', async () => {
    const req = {
      body: {
        nrp: '1',
        email: 'user@example.com',
        whatsapp: '+62 812-3456-7890'
      }
    };
    const res = createRes();
    await updateUserData(req, res, () => {});
    expect(userModel.updateUser).toHaveBeenCalledWith('1', expect.objectContaining({
      whatsapp: '6281234567890'
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
