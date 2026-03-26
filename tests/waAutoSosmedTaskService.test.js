import { jest } from '@jest/globals';

//  Mocks 
const mockFetchSinglePostKhusus = jest.fn();
const mockFetchAndStoreSingleTiktokPost = jest.fn();
const mockQuery = jest.fn();
const mockEnqueueSend = jest.fn();
const mockIsBroadcastMessage = jest.fn();
const mockExtractUrls = jest.fn();
const mockFormatDate = jest.fn().mockReturnValue('Senin, 2 Juni 2025');
const mockResolveClientIdForGroup = jest.fn();
const mockGetConfigOrDefault = jest.fn();
const mockFindActiveSession = jest.fn();
const mockFindActiveOperatorByPhone = jest.fn();
const mockHandleUnregisteredBroadcast = jest.fn();
const mockHandleRegistrationDialog = jest.fn();
const mockHandleFetchLikesInstagram = jest.fn();
const mockHandleFetchKomentarTiktokBatch = jest.fn();
const mockGetLikesByShortcode = jest.fn();
const mockGetCommentsByVideoId = jest.fn();

jest.unstable_mockModule('../src/handler/fetchpost/instaFetchPost.js', () => ({
  fetchSinglePostKhusus: mockFetchSinglePostKhusus,
}));

jest.unstable_mockModule('../src/handler/fetchpost/tiktokFetchPost.js', () => ({
  fetchAndStoreSingleTiktokPost: mockFetchAndStoreSingleTiktokPost,
}));

jest.unstable_mockModule('../src/db/postgres.js', () => ({
  query: mockQuery,
}));

jest.unstable_mockModule('../src/service/waOutbox.js', () => ({
  enqueueSend: mockEnqueueSend,
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.unstable_mockModule('../src/service/sosmedBroadcastParser.js', () => ({
  isBroadcastMessage: mockIsBroadcastMessage,
  extractUrls: mockExtractUrls,
  formatDate: mockFormatDate,
}));

jest.unstable_mockModule('../src/service/clientConfigService.js', () => ({
  resolveClientIdForGroup: mockResolveClientIdForGroup,
  getConfig: jest.fn(),
  getConfigOrDefault: mockGetConfigOrDefault,
}));

jest.unstable_mockModule('../src/repository/operatorRegistrationSessionRepository.js', () => ({
  findActiveSession: mockFindActiveSession,
  upsertSession: jest.fn(),
  deleteSession: jest.fn(),
  isRateLimited: jest.fn(),
  purgeExpiredSessions: jest.fn(),
}));

jest.unstable_mockModule('../src/repository/operatorRepository.js', () => ({
  findActiveOperatorByPhone: mockFindActiveOperatorByPhone,
  upsertOperator: jest.fn(),
}));

jest.unstable_mockModule('../src/service/operatorRegistrationService.js', () => ({
  handleUnregisteredBroadcast: mockHandleUnregisteredBroadcast,
  handleRegistrationDialog: mockHandleRegistrationDialog,
}));

jest.unstable_mockModule('../src/handler/fetchengagement/fetchLikesInstagram.js', () => ({
  handleFetchLikesInstagram: mockHandleFetchLikesInstagram,
}));

jest.unstable_mockModule('../src/handler/fetchengagement/fetchCommentTiktok.js', () => ({
  handleFetchKomentarTiktokBatch: mockHandleFetchKomentarTiktokBatch,
}));

jest.unstable_mockModule('../src/model/instaLikeModel.js', () => ({
  getLikesByShortcode: mockGetLikesByShortcode,
}));

jest.unstable_mockModule('../src/model/tiktokCommentModel.js', () => ({
  getCommentsByVideoId: mockGetCommentsByVideoId,
}));

//  Load SUT 
let handleAutoSosmedTaskMessageIfApplicable;

beforeAll(async () => {
  ({ handleAutoSosmedTaskMessageIfApplicable } = await import(
    '../src/service/waAutoSosmedTaskService.js'
  ));
});

beforeEach(() => {
  jest.clearAllMocks();

  // Happy-path defaults
  mockIsBroadcastMessage.mockReturnValue(true);
  mockExtractUrls.mockReturnValue({
    igUrls: ['https://instagram.com/p/abc123'],
    tiktokUrls: [],
  });
  mockGetConfigOrDefault.mockResolvedValue('Tugas dari broadcast Anda telah diinputkan untuk klien {client_id}.');
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockEnqueueSend.mockResolvedValue(undefined);
  mockFetchSinglePostKhusus.mockResolvedValue({ like_count: 99 });
  mockFetchAndStoreSingleTiktokPost.mockResolvedValue({ commentCount: 42 });
  mockHandleFetchLikesInstagram.mockResolvedValue(undefined);
  mockHandleFetchKomentarTiktokBatch.mockResolvedValue(undefined);
  mockGetLikesByShortcode.mockResolvedValue([]);
  mockGetCommentsByVideoId.mockResolvedValue({ comments: [] });
  mockFindActiveSession.mockResolvedValue(null);
  mockFindActiveOperatorByPhone.mockResolvedValue(null);
  mockResolveClientIdForGroup.mockResolvedValue(null);
});

const waClient = () => ({ readMessages: jest.fn().mockResolvedValue(undefined) });

//  STATUS@BROADCAST guard 
describe('status@broadcast guard', () => {
  test('returns false immediately for status@broadcast JID', async () => {
    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'any',
      chatId: 'status@broadcast',
      senderPhone: '628111',
      messageKey: null,
      waClient: waClient(),
    });
    expect(result).toBe(false);
    expect(mockEnqueueSend).not.toHaveBeenCalled();
  });
});

//  GROUP PATH 
describe('group path (@g.us)', () => {
  const chatId = '1234567890@g.us';

  test('returns false when group has no registered client_id', async () => {
    mockResolveClientIdForGroup.mockResolvedValue(null);
    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'broadcast',
      chatId,
      senderPhone: '628111',
      messageKey: null,
      waClient: waClient(),
    });
    expect(result).toBe(false);
    expect(mockEnqueueSend).not.toHaveBeenCalled();
  });

  test('returns false when message is not broadcast format', async () => {
    mockResolveClientIdForGroup.mockResolvedValue('CL1');
    mockIsBroadcastMessage.mockReturnValue(false);

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'random message',
      chatId,
      senderPhone: '628111',
      messageKey: null,
      waClient: waClient(),
    });
    expect(result).toBe(false);
    expect(mockEnqueueSend).not.toHaveBeenCalled();
  });

  test('records to DB and sends exactly one ack (Response A) for valid group broadcast', async () => {
    mockResolveClientIdForGroup.mockResolvedValue('CL1');
    mockIsBroadcastMessage.mockReturnValue(true);
    mockExtractUrls.mockReturnValue({ igUrls: ['https://instagram.com/p/abc123'], tiktokUrls: [] });

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'pagi mohon izin dibantu like https://instagram.com/p/abc123',
      chatId,
      senderPhone: '628111',
      messageKey: null,
      waClient: waClient(),
    });

    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(1); // DB insert for IG URL
    expect(mockEnqueueSend).toHaveBeenCalledTimes(1); // Response A
    const [sendChatId, payload] = mockEnqueueSend.mock.calls[0];
    expect(sendChatId).toBe(chatId);
    expect(payload.text).toMatch(/Senin, 2 Juni 2025/);
    expect(payload.text).toMatch(/1 URL/);
  });
});

//  DM PATH  active session 
describe('DM path  active registration session', () => {
  const chatId = '628111@s.whatsapp.net';
  const senderPhone = '628111';

  test('delegates to handleRegistrationDialog when session is active', async () => {
    mockFindActiveSession.mockResolvedValue({ stage: 'awaiting_confirmation', msg: 'orig broadcast' });

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'ya',
      chatId,
      senderPhone,
      messageKey: null,
      waClient: waClient(),
    });

    expect(result).toBe(true);
    expect(mockHandleRegistrationDialog).toHaveBeenCalledWith(
      senderPhone,
      'ya',
      mockEnqueueSend,
      expect.any(Function),
      chatId // replyJid = chatId (the actual incoming JID)
    );
    expect(mockFindActiveOperatorByPhone).not.toHaveBeenCalled();
  });
});

//  DM PATH  registered operator 
describe('DM path  registered operator', () => {
  const senderPhone = '628222';
  const chatId = `${senderPhone}@s.whatsapp.net`;
  const clientId = 'CL2';

  beforeEach(() => {
    mockFindActiveOperatorByPhone.mockResolvedValue({ client_id: clientId });
  });

  test('returns false when message is not broadcast format', async () => {
    mockIsBroadcastMessage.mockReturnValue(false);

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'random',
      chatId,
      senderPhone,
      messageKey: null,
      waClient: waClient(),
    });

    expect(result).toBe(false);
    expect(mockEnqueueSend).not.toHaveBeenCalled();
  });

  test('sends Response B (recap) + Response C (ack) + Response D (task list) for valid DM broadcast', async () => {
    mockIsBroadcastMessage.mockReturnValue(true);
    mockExtractUrls.mockReturnValue({
      igUrls: ['https://instagram.com/p/xyz'],
      tiktokUrls: ['https://www.tiktok.com/@a/video/123'],
    });
    mockFetchSinglePostKhusus.mockResolvedValue({ like_count: 55 });
    mockFetchAndStoreSingleTiktokPost.mockResolvedValue({ commentCount: 10 });
    mockGetConfigOrDefault.mockResolvedValue('Tugas dari broadcast Anda telah diinputkan untuk klien {client_id}.');

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'pagi mohon izin dibantu like https://instagram.com/p/xyz https://www.tiktok.com/@a/video/123',
      chatId,
      senderPhone,
      messageKey: { id: 'msgkey1' },
      waClient: waClient(),
    });

    expect(result).toBe(true);
    // Expect 3 messages: recap, ack, task list (no "Fetch sukses")
    expect(mockEnqueueSend).toHaveBeenCalledTimes(3);

    const texts = mockEnqueueSend.mock.calls.map(([, p]) => p.text);

    // All sent to the correct JID
    mockEnqueueSend.mock.calls.forEach(([jid]) => expect(jid).toBe(chatId));

    // Response 1: engagement recap with new format header
    expect(texts[0]).toMatch(/\*Rekap Tugas Sosmed\*/);

    // Response 2: ack contains clientId
    expect(texts[1]).toContain(clientId);

    // Response 3: task list
    expect(texts[2]).toMatch(/Daftar tugas/);

    // Engagement sync handlers were called after post fetch
    expect(mockHandleFetchLikesInstagram).toHaveBeenCalledWith(null, null, clientId);
    expect(mockHandleFetchKomentarTiktokBatch).toHaveBeenCalledWith(null, null, clientId);
  });

  test('DB insert called with senderPhone for registered operator', async () => {
    mockIsBroadcastMessage.mockReturnValue(true);
    mockExtractUrls.mockReturnValue({ igUrls: ['https://instagram.com/p/xyz'], tiktokUrls: [] });

    await handleAutoSosmedTaskMessageIfApplicable({
      text: 'pagi mohon izin dibantu like https://instagram.com/p/xyz',
      chatId,
      senderPhone,
      messageKey: null,
      waClient: waClient(),
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO insta_post'),
      [clientId, 'xyz', senderPhone] // phoneNumber normalised = senderPhone when no suffix
    );
  });
});

//  DM PATH  unregistered 
describe('DM path  unregistered number', () => {
  const senderPhone = '628333';
  const chatId = `${senderPhone}@s.whatsapp.net`;

  test('calls handleUnregisteredBroadcast for unregistered broadcast format', async () => {
    mockIsBroadcastMessage.mockReturnValue(true);

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'pagi mohon izin dibantu like',
      chatId,
      senderPhone,
      messageKey: null,
      waClient: waClient(),
    });

    expect(result).toBe(true);
    expect(mockHandleUnregisteredBroadcast).toHaveBeenCalledWith(
      senderPhone,
      'pagi mohon izin dibantu like',
      mockEnqueueSend,
      chatId // replyJid = chatId
    );
  });

  test('returns false and does not call handleUnregisteredBroadcast if not broadcast format', async () => {
    mockIsBroadcastMessage.mockReturnValue(false);

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'just a normal message',
      chatId,
      senderPhone,
      messageKey: null,
      waClient: waClient(),
    });

    expect(result).toBe(false);
    expect(mockHandleUnregisteredBroadcast).not.toHaveBeenCalled();
    expect(mockEnqueueSend).not.toHaveBeenCalled();
  });
});

//  DM PATH  @newsletter filter
describe('DM path  @newsletter JID guard', () => {
  test('returns false immediately for @newsletter JID without any lookup', async () => {
    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'pagi mohon ijin dibantu like',
      chatId: '120363177451408952@newsletter',
      senderPhone: '120363177451408952@newsletter',
      messageKey: null,
      waClient: waClient(),
    });

    expect(result).toBe(false);
    expect(mockFindActiveSession).not.toHaveBeenCalled();
    expect(mockFindActiveOperatorByPhone).not.toHaveBeenCalled();
    expect(mockEnqueueSend).not.toHaveBeenCalled();
  });
});

//  DM PATH  @lid JID normalisation
describe('DM path  @lid JID normalisation', () => {
  const lidPhone = '48963281543271';
  const lidChatId = `${lidPhone}@lid`;
  const senderPhoneLid = `${lidPhone}@lid`;

  test('strips @lid suffix for session lookup and uses chatId as dmJid for unregistered', async () => {
    mockIsBroadcastMessage.mockReturnValue(true);

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'pagi mohon ijin dibantu like',
      chatId: lidChatId,
      senderPhone: senderPhoneLid,
      messageKey: null,
      waClient: waClient(),
    });

    expect(result).toBe(true);
    // DB lookup should use digits-only, NOT raw @lid JID
    expect(mockFindActiveSession).toHaveBeenCalledWith(expect.anything(), lidPhone);
    expect(mockFindActiveOperatorByPhone).toHaveBeenCalledWith(expect.anything(), lidPhone);
    // Reply JID should be chatId (@lid), not a reconstructed @s.whatsapp.net
    expect(mockHandleUnregisteredBroadcast).toHaveBeenCalledWith(
      lidPhone,
      'pagi mohon ijin dibantu like',
      mockEnqueueSend,
      lidChatId
    );
  });

  test('strips @lid suffix for session lookup for active session path', async () => {
    mockFindActiveSession.mockResolvedValue({ stage: 'awaiting_confirmation', msg: 'orig' });

    await handleAutoSosmedTaskMessageIfApplicable({
      text: 'ya',
      chatId: lidChatId,
      senderPhone: senderPhoneLid,
      messageKey: null,
      waClient: waClient(),
    });

    expect(mockFindActiveSession).toHaveBeenCalledWith(expect.anything(), lidPhone);
    expect(mockHandleRegistrationDialog).toHaveBeenCalledWith(
      lidPhone,
      'ya',
      mockEnqueueSend,
      expect.any(Function),
      lidChatId
    );
  });
});