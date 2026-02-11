import { jest } from '@jest/globals';

// Set required environment variables
process.env.JWT_SECRET = 'testsecret';
process.env.TZ = 'Asia/Jakarta';

// Mock dependencies
const mockQuery = jest.fn();
const mockFindById = jest.fn();
const mockUpdate = jest.fn();

jest.unstable_mockModule('../src/repository/db.js', () => ({
  query: mockQuery,
}));

jest.unstable_mockModule('../src/model/clientModel.js', () => ({
  findById: mockFindById,
  update: mockUpdate,
  findByOperator: jest.fn(),
  findBySuperAdmin: jest.fn(),
}));

jest.unstable_mockModule('../src/utils/waHelper.js', () => ({
  isAdminWhatsApp: jest.fn(() => false),
  formatToWhatsAppId: jest.fn((num) => num),
  normalizeWhatsAppNumber: jest.fn((num) => num),
  hasSameClientIdAsAdmin: jest.fn(() => false),
}));

jest.unstable_mockModule('../src/handler/menu/menuPromptHelpers.js', () => ({
  appendSubmenuBackInstruction: jest.fn((msg) => msg),
}));

let oprRequestHandlers;

beforeAll(async () => {
  const mod = await import('../src/handler/menu/oprRequestHandlers.js');
  oprRequestHandlers = mod.oprRequestHandlers;
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('oprRequestHandlers - Account Linking', () => {
  test('link_choose_role - selects operator role', async () => {
    const session = {
      menu: 'oprrequest',
      step: 'link_choose_role',
      opr_clients: [
        { client_id: 'CLIENT1', nama: 'Client One' },
        { client_id: 'CLIENT2', nama: 'Client Two' },
      ],
      linking_wa_id: '628123456789',
    };
    const chatId = '628123456789@s.whatsapp.net';
    const waClient = { sendMessage: jest.fn() };
    const pool = { query: mockQuery };
    const userModel = {};

    await oprRequestHandlers.link_choose_role(
      session,
      chatId,
      '1',
      waClient,
      pool,
      userModel
    );

    expect(session.linking_role).toBe('operator');
    expect(session.step).toBe('link_choose_client');
    expect(waClient.sendMessage).toHaveBeenCalled();
    const message = waClient.sendMessage.mock.calls[0][1];
    expect(message).toContain('Operator');
    expect(message).toContain('CLIENT1');
  });

  test('link_choose_role - selects super admin role', async () => {
    const session = {
      menu: 'oprrequest',
      step: 'link_choose_role',
      opr_clients: [{ client_id: 'CLIENT1', nama: 'Client One' }],
      linking_wa_id: '628123456789',
    };
    const chatId = '628123456789@s.whatsapp.net';
    const waClient = { sendMessage: jest.fn() };
    const pool = { query: mockQuery };
    const userModel = {};

    await oprRequestHandlers.link_choose_role(
      session,
      chatId,
      '2',
      waClient,
      pool,
      userModel
    );

    expect(session.linking_role).toBe('super_admin');
    expect(session.step).toBe('link_choose_client');
    expect(waClient.sendMessage).toHaveBeenCalled();
    const message = waClient.sendMessage.mock.calls[0][1];
    expect(message).toContain('Super Admin');
  });

  test('link_choose_role - handles invalid choice', async () => {
    const session = {
      menu: 'oprrequest',
      step: 'link_choose_role',
      opr_clients: [{ client_id: 'CLIENT1', nama: 'Client One' }],
      linking_wa_id: '628123456789',
    };
    const chatId = '628123456789@s.whatsapp.net';
    const waClient = { sendMessage: jest.fn() };
    const pool = { query: mockQuery };
    const userModel = {};

    await oprRequestHandlers.link_choose_role(
      session,
      chatId,
      '3',
      waClient,
      pool,
      userModel
    );

    expect(session.linking_role).toBeUndefined();
    expect(session.step).toBe('link_choose_role');
    expect(waClient.sendMessage).toHaveBeenCalled();
    const message = waClient.sendMessage.mock.calls[0][1];
    expect(message).toContain('tidak valid');
  });

  test('link_choose_client - links operator by index', async () => {
    mockFindById.mockResolvedValue({
      client_id: 'CLIENT1',
      nama: 'Client One',
      client_operator: '',
      client_super: '',
    });
    mockUpdate.mockResolvedValue({
      client_id: 'CLIENT1',
      client_operator: '628123456789',
    });

    const session = {
      menu: 'oprrequest',
      step: 'link_choose_client',
      opr_clients: [
        { client_id: 'CLIENT1', nama: 'Client One' },
        { client_id: 'CLIENT2', nama: 'Client Two' },
      ],
      linking_wa_id: '628123456789',
      linking_role: 'operator',
    };
    const chatId = '628123456789@s.whatsapp.net';
    const waClient = { sendMessage: jest.fn() };
    const pool = { query: mockQuery };
    const userModel = {};

    await oprRequestHandlers.link_choose_client(
      session,
      chatId,
      '1',
      waClient,
      pool,
      userModel
    );

    expect(mockFindById).toHaveBeenCalledWith('CLIENT1');
    expect(mockUpdate).toHaveBeenCalledWith('CLIENT1', {
      client_operator: '628123456789',
    });
    expect(waClient.sendMessage).toHaveBeenCalled();
    const message = waClient.sendMessage.mock.calls[0][1];
    expect(message).toContain('Penautan Berhasil');
    expect(message).toContain('Operator');
    expect(message).toContain('CLIENT1');
    expect(session.menu).toBeNull();
    expect(session.step).toBeNull();
  });

  test('link_choose_client - links super admin by client_id', async () => {
    mockFindById.mockResolvedValue({
      client_id: 'CLIENT2',
      nama: 'Client Two',
      client_operator: '',
      client_super: '',
    });
    mockUpdate.mockResolvedValue({
      client_id: 'CLIENT2',
      client_super: '628987654321',
    });

    const session = {
      menu: 'oprrequest',
      step: 'link_choose_client',
      opr_clients: [
        { client_id: 'CLIENT1', nama: 'Client One' },
        { client_id: 'CLIENT2', nama: 'Client Two' },
      ],
      linking_wa_id: '628987654321',
      linking_role: 'super_admin',
    };
    const chatId = '628987654321@s.whatsapp.net';
    const waClient = { sendMessage: jest.fn() };
    const pool = { query: mockQuery };
    const userModel = {};

    await oprRequestHandlers.link_choose_client(
      session,
      chatId,
      'CLIENT2',
      waClient,
      pool,
      userModel
    );

    expect(mockFindById).toHaveBeenCalledWith('CLIENT2');
    expect(mockUpdate).toHaveBeenCalledWith('CLIENT2', {
      client_super: '628987654321',
    });
    expect(waClient.sendMessage).toHaveBeenCalled();
    const message = waClient.sendMessage.mock.calls[0][1];
    expect(message).toContain('Penautan Berhasil');
    expect(message).toContain('Super Admin');
    expect(session.menu).toBeNull();
    expect(session.step).toBeNull();
  });

  test('link_choose_client - appends to existing super admin list', async () => {
    mockFindById.mockResolvedValue({
      client_id: 'CLIENT1',
      nama: 'Client One',
      client_operator: '',
      client_super: '628111111111, 628222222222',
    });
    mockUpdate.mockResolvedValue({
      client_id: 'CLIENT1',
      client_super: '628111111111, 628222222222, 628333333333',
    });

    const session = {
      menu: 'oprrequest',
      step: 'link_choose_client',
      opr_clients: [{ client_id: 'CLIENT1', nama: 'Client One' }],
      linking_wa_id: '628333333333',
      linking_role: 'super_admin',
    };
    const chatId = '628333333333@s.whatsapp.net';
    const waClient = { sendMessage: jest.fn() };
    const pool = { query: mockQuery };
    const userModel = {};

    await oprRequestHandlers.link_choose_client(
      session,
      chatId,
      '1',
      waClient,
      pool,
      userModel
    );

    expect(mockUpdate).toHaveBeenCalledWith('CLIENT1', {
      client_super: '628111111111, 628222222222, 628333333333',
    });
    const message = waClient.sendMessage.mock.calls[0][1];
    expect(message).toContain('Penautan Berhasil');
  });

  test('link_choose_client - handles invalid client selection', async () => {
    const session = {
      menu: 'oprrequest',
      step: 'link_choose_client',
      opr_clients: [{ client_id: 'CLIENT1', nama: 'Client One' }],
      linking_wa_id: '628123456789',
      linking_role: 'operator',
    };
    const chatId = '628123456789@s.whatsapp.net';
    const waClient = { sendMessage: jest.fn() };
    const pool = { query: mockQuery };
    const userModel = {};

    await oprRequestHandlers.link_choose_client(
      session,
      chatId,
      '999',
      waClient,
      pool,
      userModel
    );

    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(waClient.sendMessage).toHaveBeenCalled();
    const message = waClient.sendMessage.mock.calls[0][1];
    expect(message).toContain('tidak valid');
    expect(session.step).toBe('link_choose_client');
  });

  test('link_choose_role - handles cancel', async () => {
    const session = {
      menu: 'oprrequest',
      step: 'link_choose_role',
      opr_clients: [{ client_id: 'CLIENT1', nama: 'Client One' }],
      linking_wa_id: '628123456789',
    };
    const chatId = '628123456789@s.whatsapp.net';
    const waClient = { sendMessage: jest.fn() };
    const pool = { query: mockQuery };
    const userModel = {};

    await oprRequestHandlers.link_choose_role(
      session,
      chatId,
      'batal',
      waClient,
      pool,
      userModel
    );

    expect(session.menu).toBeNull();
    expect(session.step).toBeNull();
    expect(session.opr_clients).toBeUndefined();
    expect(session.linking_wa_id).toBeUndefined();
    expect(waClient.sendMessage).toHaveBeenCalled();
    const message = waClient.sendMessage.mock.calls[0][1];
    expect(message).toContain('dibatalkan');
  });

  test('link_choose_client - handles cancel', async () => {
    const session = {
      menu: 'oprrequest',
      step: 'link_choose_client',
      opr_clients: [{ client_id: 'CLIENT1', nama: 'Client One' }],
      linking_wa_id: '628123456789',
      linking_role: 'operator',
    };
    const chatId = '628123456789@s.whatsapp.net';
    const waClient = { sendMessage: jest.fn() };
    const pool = { query: mockQuery };
    const userModel = {};

    await oprRequestHandlers.link_choose_client(
      session,
      chatId,
      'batal',
      waClient,
      pool,
      userModel
    );

    expect(session.menu).toBeNull();
    expect(session.step).toBeNull();
    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    const message = waClient.sendMessage.mock.calls[0][1];
    expect(message).toContain('dibatalkan');
  });
});
