import { jest } from '@jest/globals';

const respondComplaintMessageMock = jest.fn();
const parseComplaintMessageMock = jest.fn((message) => {
  const nrpMatch = /NRP\s*[:：]\s*(\d+)/i.exec(message || '');
  const hasKendala = /\bkendala\b/i.test(message || '');
  return {
    raw: message,
    nrp: nrpMatch ? nrpMatch[1] : '',
    issues: hasKendala ? ['dummy issue'] : [],
  };
});

jest.unstable_mockModule('../src/handler/menu/clientRequestHandlers.js', () => ({
  clientRequestHandlers: {
    respondComplaint_message: respondComplaintMessageMock,
    main: jest.fn(),
  },
}));

jest.unstable_mockModule('../src/service/complaintService.js', () => ({
  parseComplaintMessage: parseComplaintMessageMock,
}));

jest.unstable_mockModule('../src/utils/utilsHelper.js', () => ({
  normalizeUserId: jest.fn((value) =>
    value === undefined || value === null ? '' : String(value).replace(/\D/g, '')
  ),
}));

const {
  handleComplaintMessageIfApplicable,
  shouldHandleComplaintMessage,
} = await import('../src/service/waAutoComplaintService.js');

describe('waAutoComplaintService', () => {
  const originalGatewayAdmin = process.env.GATEWAY_WHATSAPP_ADMIN;
  const originalComplaintDelay = process.env.COMPLAINT_RESPONSE_DELAY_MS;
  const originalUseLegacyFlow = process.env.WA_COMPLAINT_USE_LEGACY_FLOW;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalGatewayAdmin === undefined) {
      delete process.env.GATEWAY_WHATSAPP_ADMIN;
    } else {
      process.env.GATEWAY_WHATSAPP_ADMIN = originalGatewayAdmin;
    }


    if (originalComplaintDelay === undefined) {
      delete process.env.COMPLAINT_RESPONSE_DELAY_MS;
    } else {
      process.env.COMPLAINT_RESPONSE_DELAY_MS = originalComplaintDelay;
    }

    if (originalUseLegacyFlow === undefined) {
      delete process.env.WA_COMPLAINT_USE_LEGACY_FLOW;
    } else {
      process.env.WA_COMPLAINT_USE_LEGACY_FLOW = originalUseLegacyFlow;
    }
  });

  test('should handle complaint message and invoke responder', async () => {
    const chatId = 'admin-chat';
    const adminOptionSessions = {
      [chatId]: { timeout: setTimeout(() => {}, 1000) },
    };
    const sessions = new Map();
    const setSession = (id, data) => {
      sessions.set(id, { ...data, time: Date.now() });
    };
    const getSession = (id) => sessions.get(id);

    const complaintMessage = [
      'Pesan Komplain',
      'NRP    : 12345',
      '',
      'Kendala',
      '- Sudah melaksanakan Instagram belum terdata.',
    ].join('\n');

    const handled = await handleComplaintMessageIfApplicable({
      text: complaintMessage,
      allowUserMenu: false,
      session: null,
      isAdmin: true,
      initialIsMyContact: true,
      chatId,
      adminOptionSessions,
      setSession,
      getSession,
      waClient: {},
      pool: {},
      userModel: {},
    });

    expect(handled).toBe(true);
    expect(respondComplaintMessageMock).toHaveBeenCalledTimes(1);
    expect(respondComplaintMessageMock.mock.calls[0][0]).toMatchObject({
      menu: 'clientrequest',
      step: 'respondComplaint_message',
      respondComplaint: {},
    });
    expect(adminOptionSessions[chatId]).toBeUndefined();
    expect(getSession(chatId)).toMatchObject({ menu: 'clientrequest' });
  });

  test('allows structured complaints from unregistered WhatsApp senders', async () => {
    const chatId = 'public-chat';
    const adminOptionSessions = {};
    const sessions = new Map();
    const setSession = (id, data) => {
      sessions.set(id, { ...data, time: Date.now() });
    };
    const getSession = (id) => sessions.get(id);

    const complaintMessage = [
      'Pesan Komplain',
      'NRP    : 99999',
      '',
      'Kendala',
      '- Akses dashboard terkunci.',
    ].join('\n');

    const handled = await handleComplaintMessageIfApplicable({
      text: complaintMessage,
      allowUserMenu: false,
      session: null,
      isAdmin: false,
      initialIsMyContact: false,
      senderId: '62001234@c.us',
      chatId,
      adminOptionSessions,
      setSession,
      getSession,
      waClient: {},
      pool: {},
      userModel: {},
    });

    expect(handled).toBe(true);
    expect(respondComplaintMessageMock).toHaveBeenCalledTimes(1);
    expect(getSession(chatId)).toMatchObject({ menu: 'clientrequest' });
  });

  test('accepts complaints with a preamble before the header', () => {
    const complaintMessage = [
      'Mohon dibantu untuk laporan berikut.',
      'Pesan Komplain',
      'NRP    : 12345',
      '',
      'Kendala',
      '- Data belum masuk.',
    ].join('\n');

    const result = shouldHandleComplaintMessage({
      text: complaintMessage,
      allowUserMenu: false,
      session: null,
      isAdmin: true,
      initialIsMyContact: true,
    });

    expect(result).toBe(true);
  });

  test('should not handle when header or verification is missing', async () => {
    const result = shouldHandleComplaintMessage({
      text: 'Pesan Biasa',
      allowUserMenu: false,
      session: null,
      isAdmin: true,
      initialIsMyContact: true,
    });
    expect(result).toBe(false);

    const handled = await handleComplaintMessageIfApplicable({
      text: 'Pesan Biasa',
      allowUserMenu: false,
      session: null,
      isAdmin: false,
      initialIsMyContact: false,
      chatId: 'chat',
      adminOptionSessions: {},
      setSession: jest.fn(),
      getSession: jest.fn(),
      waClient: {},
      pool: {},
      userModel: {},
    });
    expect(handled).toBe(false);
    expect(respondComplaintMessageMock).not.toHaveBeenCalled();
  });

  test('skips gateway-forwarded complaints when relayed between gateways', async () => {
    process.env.GATEWAY_WHATSAPP_ADMIN = '6200002,6200003';
    const adminOptionSessions = {};
    const sessions = new Map();
    const setSession = (id, data) => {
      sessions.set(id, { ...data, time: Date.now() });
    };
    const getSession = (id) => sessions.get(id);

    const complaintMessage = [
      'Pesan Komplain',
      'NRP : 98765',
      'Kendala: tidak bisa login',
    ].join('\n');

    const firstHandled = await handleComplaintMessageIfApplicable({
      text: complaintMessage,
      allowUserMenu: false,
      session: null,
      isAdmin: false,
      initialIsMyContact: true,
      senderId: '6200111@c.us',
      chatId: 'chat-a',
      adminOptionSessions,
      setSession,
      getSession,
      waClient: {},
      pool: {},
      userModel: {},
    });

    const secondHandled = await handleComplaintMessageIfApplicable({
      text: `wagateway forward\n${complaintMessage}`,
      allowUserMenu: false,
      session: null,
      isAdmin: false,
      initialIsMyContact: true,
      senderId: '6200002@s.whatsapp.net',
      chatId: 'chat-b',
      adminOptionSessions,
      setSession,
      getSession,
      waClient: {},
      pool: {},
      userModel: {},
    });

    expect(firstHandled).toBe(true);
    expect(secondHandled).toBe(false);
    expect(respondComplaintMessageMock).toHaveBeenCalledTimes(1);
  });

  test('accepts complaints with starred header *Pesan Komplain*', async () => {
    const chatId = 'starred-chat';
    const adminOptionSessions = {};
    const sessions = new Map();
    const setSession = (id, data) => {
      sessions.set(id, { ...data, time: Date.now() });
    };
    const getSession = (id) => sessions.get(id);

    const complaintMessage = [
      '*Pesan Komplain*',
      'NRP : 72120290',
      'Nama : DARTOK DARMAWAN',
      'Satker : DITINTELKAM POLDA JATIM',
      'Username IG : @dartokdarmawan72',
      'Username Tiktok : @dartok7853',
      '',
      'Kendala',
      '- sudah melaksanakan Instagram belum terdata',
      '- sudah melaksanakan tiktok belum terdata.',
    ].join('\n');

    const handled = await handleComplaintMessageIfApplicable({
      text: complaintMessage,
      allowUserMenu: false,
      session: null,
      isAdmin: false,
      initialIsMyContact: false,
      senderId: '6299999@c.us',
      chatId,
      adminOptionSessions,
      setSession,
      getSession,
      waClient: {},
      pool: {},
      userModel: {},
    });

    expect(handled).toBe(true);
    expect(respondComplaintMessageMock).toHaveBeenCalledTimes(1);
    expect(getSession(chatId)).toMatchObject({ menu: 'clientrequest' });
  });

  test('group complaint sends operator response to group and summary to requester only', async () => {
    process.env.WA_COMPLAINT_USE_LEGACY_FLOW = 'false';
    process.env.COMPLAINT_RESPONSE_DELAY_MS = '0';

    const sendMessage = jest.fn(async () => ({}));

    const handled = await handleComplaintMessageIfApplicable({
      text: [
        'Pesan Komplain',
        'NRP: 75020201',
        'Nama: Tester',
        'Username IG: @tester',
        '',
        'Kendala',
        '- Sudah melaksanakan Instagram belum terdata.',
      ].join('\n'),
      allowUserMenu: false,
      session: null,
      senderId: '628123@c.us',
      chatId: '120111@g.us',
      adminOptionSessions: {},
      setSession: jest.fn(),
      getSession: jest.fn(),
      waClient: { sendMessage },
      pool: { query: jest.fn(async () => ({ rows: [] })) },
      userModel: {},
    });

    expect(handled).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith('120111@g.us', expect.any(String));
    expect(sendMessage).toHaveBeenCalledWith('628123@c.us', expect.any(String));
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  test('private complaint sends response only to requester chat', async () => {
    process.env.WA_COMPLAINT_USE_LEGACY_FLOW = 'false';
    process.env.COMPLAINT_RESPONSE_DELAY_MS = '0';

    const sendMessage = jest.fn(async () => ({}));

    const handled = await handleComplaintMessageIfApplicable({
      text: [
        'Pesan Komplain',
        'NRP: 75020201',
        'Nama: Tester',
        'Username IG: @tester',
        '',
        'Kendala',
        '- Sudah melaksanakan Instagram belum terdata.',
      ].join('\n'),
      allowUserMenu: false,
      session: null,
      senderId: '628123@c.us',
      chatId: '628123@c.us',
      adminOptionSessions: {},
      setSession: jest.fn(),
      getSession: jest.fn(),
      waClient: { sendMessage },
      pool: { query: jest.fn(async () => ({ rows: [] })) },
      userModel: {},
    });

    expect(handled).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith('628123@c.us', expect.any(String));
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });


  test('shouldHandleComplaintMessage returns true for starred header', () => {
    const complaintMessage = [
      '*Pesan Komplain*',
      'NRP : 72120290',
      'Nama : DARTOK DARMAWAN',
      '',
      'Kendala',
      '- sudah melaksanakan Instagram belum terdata',
    ].join('\n');

    const result = shouldHandleComplaintMessage({
      text: complaintMessage,
      allowUserMenu: false,
      session: null,
      isAdmin: false,
      initialIsMyContact: false,
    });

    expect(result).toBe(true);
  });
});