import { jest } from '@jest/globals';

// --- Mocks hoisted before dynamic imports ---

const enqueueSendMock = jest.fn().mockResolvedValue(undefined);
const triageComplaintMock = jest.fn();
const parseComplaintMessageMock = jest.fn();
const fetchSocialProfileMock = jest.fn();

jest.unstable_mockModule('../src/service/waOutbox.js', () => ({
  enqueueSend: enqueueSendMock,
  attachWorker: jest.fn(),
  outboxQueue: { add: jest.fn() },
}));

jest.unstable_mockModule('../src/service/complaintTriageService.js', () => ({
  triageComplaint: triageComplaintMock,
}));

jest.unstable_mockModule('../src/service/complaintParser.js', () => ({
  parseComplaintMessage: parseComplaintMessageMock,
}));

jest.unstable_mockModule('../src/service/rapidApiProfileService.js', () => ({
  fetchSocialProfile: fetchSocialProfileMock,
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule('../src/repository/complaintRepository.js', () => ({
  getUserByNrp: jest.fn(),
  getAuditCounts: jest.fn(),
  updateUserSocialHandle: jest.fn().mockResolvedValue(undefined),
  getLatestPost: jest.fn(),
}));

jest.unstable_mockModule('../src/service/complaintResponseTemplates.js', () => ({
  buildOperatorResponse: jest.fn().mockReturnValue('Operator response'),
  buildAdminSummary: jest.fn().mockReturnValue('Admin summary'),
  buildMismatchConfirmationDM: jest.fn().mockReturnValue('DM body'),
  buildProfileLink: jest.fn().mockReturnValue('https://example.com'),
}));

jest.unstable_mockModule('../src/service/pendingConfirmationStore.js', () => ({
  setConfirmation: jest.fn(),
  getConfirmation: jest.fn().mockReturnValue(null),
  deleteConfirmation: jest.fn(),
  getConfirmationStoreStat: jest.fn().mockReturnValue({ size: 0, maxEntries: 1000 }),
}));

let handleComplaintMessageIfApplicable;
let shouldHandleComplaintMessage;
let isGatewayComplaintForward;

beforeAll(async () => {
  ({
    handleComplaintMessageIfApplicable,
    shouldHandleComplaintMessage,
    isGatewayComplaintForward,
  } = await import('../src/service/waAutoComplaintService.js'));
});

// Build a mock pool
function makePool() {
  return { query: jest.fn().mockResolvedValue({ rows: [] }) };
}

// Build a mock triage result
function makeTriage(overrides = {}) {
  return {
    status: 'NEED_MORE_DATA',
    diagnosisCode: 'SYNC_PENDING',
    confidence: 0.7,
    evidence: { internal: {}, rapidapi: {} },
    nextActions: ['Tunggu sinkronisasi.'],
    operatorResponse: 'Cek ulang setelah 30 menit.',
    adminSummary: 'Summary untuk admin.',
    ...overrides,
  };
}

// Build a valid parsed complaint
function makeParsedComplaint(overrides = {}) {
  return {
    isComplaint: true,
    reporter: { nrp: '12345', nama: 'John Doe', polres: 'Test', igUsername: 'johndoe', tiktokUsername: '' },
    issues: ['belum terdata'],
    raw: { normalizedText: '' },
    ...overrides,
  };
}

const VALID_COMPLAINT_TEXT = [
  'Pesan Komplain',
  'NRP: 12345',
  'Nama: John Doe',
  'Polres: Test',
  'Username IG: johndoe',
  'Kendala',
  '- Belum terdata',
].join('\n');

const GROUP_CHAT_ID = '628100000000@g.us';
const SENDER_JID = '628200000000@c.us';

let fakeWaClient;

beforeEach(() => {
  jest.clearAllMocks();
  fakeWaClient = {
    sendSeen: jest.fn().mockResolvedValue(undefined),
    sendMessage: jest.fn().mockResolvedValue(undefined),
  };

  // Default: complaint is valid
  parseComplaintMessageMock.mockReturnValue(makeParsedComplaint());
  triageComplaintMock.mockResolvedValue(makeTriage());
});

describe('handleComplaintMessageIfApplicable — enqueueSend assertions', () => {
  test('(a) enqueueSend called with (chatId, { text: operatorResponse }) for group reply', async () => {
    const triage = makeTriage({ operatorResponse: 'Respons operator', adminSummary: 'Admin DM' });
    triageComplaintMock.mockResolvedValue(triage);

    await handleComplaintMessageIfApplicable({
      text: VALID_COMPLAINT_TEXT,
      allowUserMenu: false,
      session: null,
      senderId: SENDER_JID,
      chatId: GROUP_CHAT_ID,
      waClient: fakeWaClient,
      pool: makePool(),
    });

    expect(enqueueSendMock).toHaveBeenCalledWith(GROUP_CHAT_ID, { text: 'Respons operator' });
  });

  test('(b) enqueueSend called with (senderJid, { text: adminSummary }) for DM when complaint from group', async () => {
    const triage = makeTriage({ operatorResponse: 'Respons operator', adminSummary: 'Admin DM' });
    triageComplaintMock.mockResolvedValue(triage);

    await handleComplaintMessageIfApplicable({
      text: VALID_COMPLAINT_TEXT,
      allowUserMenu: false,
      session: null,
      senderId: SENDER_JID,
      chatId: GROUP_CHAT_ID,
      waClient: fakeWaClient,
      pool: makePool(),
    });

    expect(enqueueSendMock).toHaveBeenCalledWith(SENDER_JID, { text: 'Admin DM' });
  });

  test('(c) sendSeen called before enqueueSend for valid complaint', async () => {
    const callOrder = [];
    fakeWaClient.sendSeen.mockImplementation(() => {
      callOrder.push('sendSeen');
      return Promise.resolve();
    });
    enqueueSendMock.mockImplementation(() => {
      callOrder.push('enqueueSend');
      return Promise.resolve();
    });

    await handleComplaintMessageIfApplicable({
      text: VALID_COMPLAINT_TEXT,
      allowUserMenu: false,
      session: null,
      senderId: SENDER_JID,
      chatId: GROUP_CHAT_ID,
      waClient: fakeWaClient,
      pool: makePool(),
    });

    const seenIdx = callOrder.indexOf('sendSeen');
    const enqueueIdx = callOrder.indexOf('enqueueSend');
    expect(seenIdx).toBeGreaterThanOrEqual(0);
    expect(enqueueIdx).toBeGreaterThanOrEqual(0);
    expect(seenIdx).toBeLessThan(enqueueIdx);
  });

  test('(d) enqueueSend NOT called if message is not a valid complaint', async () => {
    parseComplaintMessageMock.mockReturnValue({
      isComplaint: false,
      reporter: { nrp: '', nama: '', polres: '', igUsername: '', tiktokUsername: '' },
      issues: [],
      raw: { normalizedText: '' },
    });

    const result = await handleComplaintMessageIfApplicable({
      text: 'Hello, just a normal message',
      allowUserMenu: false,
      session: null,
      senderId: SENDER_JID,
      chatId: GROUP_CHAT_ID,
      waClient: fakeWaClient,
      pool: makePool(),
    });

    expect(result).toBe(false);
    expect(enqueueSendMock).not.toHaveBeenCalled();
  });

  test('(d) enqueueSend NOT called if complaint is missing NRP', async () => {
    parseComplaintMessageMock.mockReturnValue(
      makeParsedComplaint({ reporter: { nrp: '', nama: 'x', polres: 'x', igUsername: '', tiktokUsername: '' } })
    );

    const result = await handleComplaintMessageIfApplicable({
      text: VALID_COMPLAINT_TEXT,
      allowUserMenu: false,
      session: null,
      senderId: SENDER_JID,
      chatId: GROUP_CHAT_ID,
      waClient: fakeWaClient,
      pool: makePool(),
    });

    expect(result).toBe(false);
    expect(enqueueSendMock).not.toHaveBeenCalled();
  });

  test('(e) enqueueSend NOT called when isGatewayComplaintForward is true', async () => {
    // Sender is the gateway itself
    const result = await handleComplaintMessageIfApplicable({
      text: 'WAGateway: Pesan Komplain\nNRP: 12345',
      allowUserMenu: false,
      session: null,
      senderId: '62811gateway@c.us',
      gatewayIds: ['62811gateway@c.us'],
      chatId: GROUP_CHAT_ID,
      waClient: fakeWaClient,
      pool: makePool(),
    });

    // shouldHandleComplaintMessage returns false for gateway sender
    expect(result).toBe(false);
    expect(enqueueSendMock).not.toHaveBeenCalled();
  });

  test('(f) status@broadcast is ignored — no enqueueSend', async () => {
    parseComplaintMessageMock.mockReturnValue({
      isComplaint: false,
      reporter: { nrp: '', nama: '', polres: '', igUsername: '', tiktokUsername: '' },
      issues: [],
      raw: { normalizedText: '' },
    });

    const result = await handleComplaintMessageIfApplicable({
      text: VALID_COMPLAINT_TEXT,
      allowUserMenu: false,
      session: null,
      senderId: 'status@broadcast',
      chatId: 'status@broadcast',
      waClient: fakeWaClient,
      pool: makePool(),
    });

    expect(result).toBe(false);
    expect(enqueueSendMock).not.toHaveBeenCalled();
  });

  test('(g) DM complaint (chatId === senderJid) — only ONE enqueueSend (no admin summary)', async () => {
    const dmJid = '628200000000@c.us';
    const triage = makeTriage({ operatorResponse: 'Respons grup/DM', adminSummary: 'Admin DM' });
    triageComplaintMock.mockResolvedValue(triage);

    await handleComplaintMessageIfApplicable({
      text: VALID_COMPLAINT_TEXT,
      allowUserMenu: false,
      session: null,
      senderId: dmJid,
      chatId: dmJid, // same as sender = DM complaint
      waClient: fakeWaClient,
      pool: makePool(),
    });

    expect(enqueueSendMock).toHaveBeenCalledTimes(1);
    expect(enqueueSendMock).toHaveBeenCalledWith(dmJid, { text: 'Respons grup/DM' });
    // Admin summary MUST NOT be sent
    expect(enqueueSendMock).not.toHaveBeenCalledWith(dmJid, { text: 'Admin DM' });
  });
});

describe('shouldHandleComplaintMessage', () => {
  test('returns true for a valid complaint in a group', () => {
    parseComplaintMessageMock.mockReturnValue(makeParsedComplaint());
    const result = shouldHandleComplaintMessage({
      text: VALID_COMPLAINT_TEXT,
      allowUserMenu: false,
      session: null,
      senderId: SENDER_JID,
      chatId: GROUP_CHAT_ID,
    });
    expect(result).toBe(true);
  });

  test('returns false when allowUserMenu is true', () => {
    const result = shouldHandleComplaintMessage({
      text: VALID_COMPLAINT_TEXT,
      allowUserMenu: true,
      session: null,
      senderId: SENDER_JID,
      chatId: GROUP_CHAT_ID,
    });
    expect(result).toBe(false);
  });
});
