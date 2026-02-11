import { jest } from '@jest/globals';

let validateEmail;
let userModel;
let dns;

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('validateEmail', () => {
  beforeEach(async () => {
    jest.resetModules();
    jest.unstable_mockModule('dns/promises', () => ({
      default: {
        resolveMx: jest.fn(),
      },
    }));
    jest.unstable_mockModule('../src/model/userModel.js', () => ({
      findUserByEmail: jest.fn().mockResolvedValue(null),
    }));
    ({ validateEmail } = await import('../src/controller/claimController.js'));
    userModel = await import('../src/model/userModel.js');
    dns = (await import('dns/promises')).default;
  });

  test('rejects email when format fails validator rules', async () => {
    const req = { body: { email: 'usér@example.com' } };
    const res = createRes();

    await validateEmail(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(dns.resolveMx).not.toHaveBeenCalled();
    expect(userModel.findUserByEmail).not.toHaveBeenCalled();
  });

  test('rejects email when domain has no MX records', async () => {
    dns.resolveMx.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));
    const req = { body: { email: 'user@invalid-domain.test' } };
    const res = createRes();

    await validateEmail(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Email tidak dapat digunakan. Domain email tidak aktif atau tidak menerima email.',
    });
    expect(userModel.findUserByEmail).not.toHaveBeenCalled();
  });

  test('returns service unavailable when DNS lookup fails', async () => {
    dns.resolveMx.mockRejectedValue(Object.assign(new Error('dns timeout'), { code: 'EAI_AGAIN' }));
    const req = { body: { email: 'user@example.com' } };
    const res = createRes();

    await validateEmail(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Layanan validasi email tidak tersedia. Coba beberapa saat lagi.',
    });
    expect(userModel.findUserByEmail).not.toHaveBeenCalled();
  });

  test('allows active domain after normalizing email and continues to database lookup', async () => {
    dns.resolveMx.mockResolvedValue([{ exchange: 'mail.example.com', priority: 10 }]);
    const req = { body: { email: ' User@Example.com ' } };
    const res = createRes();

    await validateEmail(req, res, () => {});

    expect(dns.resolveMx).toHaveBeenCalledWith('example.com');
    expect(userModel.findUserByEmail).toHaveBeenCalledWith('user@example.com');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('rejects inactive user email even when domain is active', async () => {
    dns.resolveMx.mockResolvedValue([{ exchange: 'mail.example.com', priority: 10 }]);
    userModel.findUserByEmail.mockResolvedValue({ status: false });
    const req = { body: { email: 'user@example.com' } };
    const res = createRes();

    await validateEmail(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Email tidak aktif. Hubungi admin untuk mengaktifkan kembali.',
    });
  });
});
