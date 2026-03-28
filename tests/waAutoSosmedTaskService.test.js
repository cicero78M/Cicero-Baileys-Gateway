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
const mockUpsertSession = jest.fn();
const mockDeleteSession = jest.fn();
const mockFindActiveOperatorByPhone = jest.fn();
const mockHandleUnregisteredBroadcast = jest.fn();
const mockHandleRegistrationDialog = jest.fn();
const mockHandleFetchLikesInstagram = jest.fn();
const mockHandleFetchKomentarTiktokBatch = jest.fn();
const mockGetLikesByShortcode = jest.fn();
const mockGetCommentsByVideoId = jest.fn();
const mockGetUsersByClientFull = jest.fn();

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
  upsertSession: mockUpsertSession,
  deleteSession: mockDeleteSession,
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

jest.unstable_mockModule('../src/model/userModel.js', () => ({
  getUsersByClientFull: mockGetUsersByClientFull,
}));

//  Load SUT 
let handleAutoSosmedTaskMessageIfApplicable;
let clearOperatorRateLimit;
let stopOperatorRateLimitEviction;

beforeAll(async () => {
  ({
    handleAutoSosmedTaskMessageIfApplicable,
    clearOperatorRateLimit,
    stopOperatorRateLimitEviction,
  } = await import(
    '../src/service/waAutoSosmedTaskService.js'
  ));
});

beforeEach(() => {
  jest.clearAllMocks();
  clearOperatorRateLimit();

  // Happy-path defaults
  mockIsBroadcastMessage.mockReturnValue(true);
  mockExtractUrls.mockReturnValue({
    igUrls: ['https://instagram.com/p/abc123'],
    tiktokUrls: [],
  });
  mockGetConfigOrDefault.mockResolvedValue('Tugas dari broadcast Anda telah diinputkan untuk klien {client_id}.');
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockEnqueueSend.mockResolvedValue(undefined);
  mockFetchSinglePostKhusus.mockResolvedValue({ shortcode: 'abc123', like_count: 99 });
  mockFetchAndStoreSingleTiktokPost.mockResolvedValue({ videoId: 'tt-default', commentCount: 42 });
  mockHandleFetchLikesInstagram.mockResolvedValue(undefined);
  mockHandleFetchKomentarTiktokBatch.mockResolvedValue(undefined);
  mockGetLikesByShortcode.mockResolvedValue([]);
  mockGetCommentsByVideoId.mockResolvedValue({ comments: [] });
  mockGetUsersByClientFull.mockResolvedValue([]);
  mockFindActiveSession.mockResolvedValue(null);
  mockUpsertSession.mockResolvedValue(undefined);
  mockDeleteSession.mockResolvedValue(undefined);
  mockFindActiveOperatorByPhone.mockResolvedValue(null);
  mockResolveClientIdForGroup.mockResolvedValue(null);
});

afterAll(() => {
  stopOperatorRateLimitEviction();
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

describe('DM path — manual input session', () => {
  const senderPhone = '628777';
  const chatId = `${senderPhone}@s.whatsapp.net`;
  const clientId = 'CL7';

  beforeEach(() => {
    mockFindActiveOperatorByPhone.mockResolvedValue({ client_id: clientId });
  });

  test('activates manual input mode via command', async () => {
    mockFindActiveSession.mockResolvedValue(null);

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'input manual ig/tiktok',
      chatId,
      senderPhone,
      messageKey: null,
      waClient: waClient(),
    });

    expect(result).toBe(true);
    expect(mockUpsertSession).toHaveBeenCalledWith(
      expect.anything(),
      senderPhone,
      'manual_input_sosmed',
      expect.any(String),
      3600,
      60
    );
    expect(mockEnqueueSend).toHaveBeenCalledTimes(1);
    expect(mockEnqueueSend.mock.calls[0][1].text).toMatch(/Mode input manual IG\/TikTok aktif/);
  });

  test('processes urls in manual mode without broadcast validator', async () => {
    mockFindActiveSession.mockResolvedValue({ stage: 'manual_input_sosmed' });
    mockIsBroadcastMessage.mockReturnValue(false);
    mockExtractUrls.mockReturnValue({
      igUrls: ['https://instagram.com/p/manual123'],
      tiktokUrls: ['https://www.tiktok.com/@a/video/999'],
    });
    mockFetchSinglePostKhusus.mockResolvedValue({ shortcode: 'manual123', like_count: 31 });
    mockFetchAndStoreSingleTiktokPost.mockResolvedValue({ videoId: '999', commentCount: 7 });

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'ini format bebas https://instagram.com/p/manual123 dan https://www.tiktok.com/@a/video/999',
      chatId,
      senderPhone,
      messageKey: null,
      waClient: waClient(),
    });

    expect(result).toBe(true);
    expect(mockIsBroadcastMessage).not.toHaveBeenCalled();
    expect(mockEnqueueSend).toHaveBeenCalledTimes(7);
    expect(mockEnqueueSend.mock.calls[0][1].text).toMatch(/Proses input manual multi-link dimulai/);
    expect(mockEnqueueSend.mock.calls[1][1].text).toMatch(/Progress Instagram 1\/1: sukses/);
    expect(mockEnqueueSend.mock.calls[2][1].text).toMatch(/Progress TikTok 1\/1: sukses/);
    expect(mockEnqueueSend.mock.calls[3][1].text).toMatch(/Summary proses input manual multi-link/);
    expect(mockHandleFetchLikesInstagram).toHaveBeenCalled();
    expect(mockHandleFetchKomentarTiktokBatch).toHaveBeenCalled();
  });

  test('exits manual mode with batal command', async () => {
    mockFindActiveSession.mockResolvedValue({ stage: 'manual_input_sosmed' });

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'batal',
      chatId,
      senderPhone,
      messageKey: null,
      waClient: waClient(),
    });

    expect(result).toBe(true);
    expect(mockDeleteSession).toHaveBeenCalledWith(expect.anything(), senderPhone);
    expect(mockEnqueueSend).toHaveBeenCalledTimes(1);
    expect(mockEnqueueSend.mock.calls[0][1].text).toMatch(/ditutup/);
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

  test('follows menu 8 flow for valid DM broadcast (start + summary)', async () => {
    mockIsBroadcastMessage.mockReturnValue(true);
    mockExtractUrls.mockReturnValue({
      igUrls: ['https://instagram.com/p/xyz'],
      tiktokUrls: ['https://www.tiktok.com/@a/video/123'],
    });
    mockFetchSinglePostKhusus.mockResolvedValue({ shortcode: 'xyz', like_count: 55 });
    mockFetchAndStoreSingleTiktokPost.mockResolvedValue({ videoId: '123', commentCount: 10 });

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'pagi mohon izin dibantu like https://instagram.com/p/xyz https://www.tiktok.com/@a/video/123',
      chatId,
      senderPhone,
      messageKey: { id: 'msgkey1' },
      waClient: waClient(),
    });

    expect(result).toBe(true);
    expect(mockEnqueueSend).toHaveBeenCalledTimes(2);

    const texts = mockEnqueueSend.mock.calls.map(([, p]) => p.text);

    mockEnqueueSend.mock.calls.forEach(([jid]) => expect(jid).toBe(chatId));

    expect(texts[0]).toMatch(/Proses input manual multi-link dimulai/);
    expect(texts[1]).toMatch(/✅ Proses input manual multi-link selesai/);
    expect(texts[1]).toMatch(/• Instagram berhasil: 1/);
    expect(texts[1]).toMatch(/• TikTok berhasil: 1/);

    // Engagement sync handlers were called after post fetch
    expect(mockHandleFetchLikesInstagram).toHaveBeenCalledWith(
      null,
      null,
      clientId,
      {
        shortcodes: ['xyz'],
        sourceType: 'manual_input',
        enrichComments: false,
      }
    );
    expect(mockHandleFetchKomentarTiktokBatch).toHaveBeenCalledWith(
      null,
      null,
      clientId,
      { sourceType: 'manual_input', videoIds: ['123'] }
    );
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
      [clientId, 'abc123', senderPhone] // shortcode berasal dari hasil fetch sukses
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

// DELTA TESTS — Phase 6 Delta Features (T037–T042)
describe('DELTA — Group broadcast with zero URLs (T042)', () => {
  const chatId = '1234567890@g.us';

  test('returns false and does not send ack when no valid platform URLs extracted', async () => {
    mockResolveClientIdForGroup.mockResolvedValue('CL1');
    mockIsBroadcastMessage.mockReturnValue(true);
    mockExtractUrls.mockReturnValue({ igUrls: [], tiktokUrls: [] });

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'pagi mohon izin dibantu like https://youtube.com/watch?v=abc',
      chatId,
      senderPhone: '628111',
      messageKey: null,
      waClient: waClient(),
    });

    expect(result).toBe(false);
    expect(mockEnqueueSend).not.toHaveBeenCalled();
  });
});

describe('DELTA — DM registered operator with zero URLs (T038)', () => {
  const senderPhone = '628222';
  const chatId = `${senderPhone}@s.whatsapp.net`;
  const clientId = 'CL2';

  test('sends exactly one error message and skips 3-part response for zero platform URLs', async () => {
    mockFindActiveOperatorByPhone.mockResolvedValue({ client_id: clientId });
    mockIsBroadcastMessage.mockReturnValue(true);
    mockExtractUrls.mockReturnValue({ igUrls: [], tiktokUrls: [] });
    mockGetConfigOrDefault.mockResolvedValue('Tidak ditemukan URL Instagram atau TikTok dalam pesan Anda.');

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'pagi mohon izin dibantu like https://youtube.com/watch?v=def',
      chatId,
      senderPhone,
      messageKey: null,
      waClient: waClient(),
    });

    expect(result).toBe(true);
    expect(mockEnqueueSend).toHaveBeenCalledTimes(1);
    const [sendChatId, payload] = mockEnqueueSend.mock.calls[0];
    expect(sendChatId).toBe(chatId);
    expect(payload.text).toBe('Tidak ditemukan URL Instagram atau TikTok dalam pesan Anda.');
    expect(mockGetConfigOrDefault).toHaveBeenCalledWith(clientId, 'operator_no_valid_url', expect.any(String));
  });
});

describe('DELTA — DM registered operator URL cap (T037)', () => {
  const senderPhone = '628222';
  const chatId = `${senderPhone}@s.whatsapp.net`;
  const clientId = 'CL2';

  test('caps URLs at 10 and logs warning when 12 URLs provided', async () => {
    mockFindActiveOperatorByPhone.mockResolvedValue({ client_id: clientId });
    mockIsBroadcastMessage.mockReturnValue(true);

    // Mock 7 IG + 5 TikTok = 12 URLs → should be capped to 10
    const igUrls = Array.from({ length: 7 }, (_, i) => `https://instagram.com/p/ig${i}`);
    const tiktokUrls = Array.from({ length: 5 }, (_, i) => `https://tiktok.com/video/tk${i}`);
    mockExtractUrls.mockReturnValue({ igUrls, tiktokUrls });

    mockGetConfigOrDefault
      .mockResolvedValueOnce('20') // rate limit
      .mockResolvedValue('Tugas dari broadcast Anda telah diinputkan untuk klien {client_id}.'); // ack

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'pagi mohon izin dibantu like [12 URLs]',
      chatId,
      senderPhone,
      messageKey: null,
      waClient: waClient(),
    });

    expect(result).toBe(true);
    expect(mockEnqueueSend).toHaveBeenCalledTimes(2); // start + summary
    expect(mockFetchSinglePostKhusus).toHaveBeenCalledTimes(7);
    expect(mockFetchAndStoreSingleTiktokPost).toHaveBeenCalledTimes(3);
    expect(mockQuery).toHaveBeenCalledTimes(10);
  });
});

describe('DELTA — DM registered operator rate limit (T039)', () => {
  const senderPhone = '628222';
  const chatId = `${senderPhone}@s.whatsapp.net`;
  const clientId = 'CL2';

  test('suppresses broadcast when rate limit exceeded and returns true with 0 enqueueSend calls', async () => {
    mockFindActiveOperatorByPhone.mockResolvedValue({ client_id: clientId });
    mockIsBroadcastMessage.mockReturnValue(true);
    mockExtractUrls.mockReturnValue({ igUrls: ['https://instagram.com/p/xyz'], tiktokUrls: [] });
    mockGetConfigOrDefault.mockResolvedValue('3'); // Low rate limit for test

    let result;
    for (let i = 0; i < 4; i += 1) {
      result = await handleAutoSosmedTaskMessageIfApplicable({
        text: 'pagi mohon izin dibantu like https://instagram.com/p/xyz',
        chatId,
        senderPhone,
        messageKey: null,
        waClient: waClient(),
      });
    }

    expect(result).toBe(true);
    expect(mockEnqueueSend).toHaveBeenCalledTimes(6);
  });
});

describe('DELTA — DM registered operator failure summary', () => {
  const senderPhone = '628222';
  const chatId = `${senderPhone}@s.whatsapp.net`;
  const clientId = 'CL2';

  test('sends failed link list when one URL fails diproses', async () => {
    mockFindActiveOperatorByPhone.mockResolvedValue({ client_id: clientId });
    mockIsBroadcastMessage.mockReturnValue(true);
    mockExtractUrls.mockReturnValue({
      igUrls: ['https://instagram.com/p/ok1'],
      tiktokUrls: ['https://tiktok.com/video/456'],
    });

    mockFetchSinglePostKhusus.mockResolvedValue({ shortcode: 'ok1', like_count: 42 });
    mockFetchAndStoreSingleTiktokPost.mockRejectedValue(new Error('fetch failed'));

    const result = await handleAutoSosmedTaskMessageIfApplicable({
      text: 'pagi mohon izin dibantu like https://instagram.com/p/ok1 https://tiktok.com/video/456',
      chatId,
      senderPhone,
      messageKey: null,
      waClient: waClient(),
    });

    expect(result).toBe(true);
    expect(mockEnqueueSend).toHaveBeenCalledTimes(3);
    expect(mockEnqueueSend.mock.calls[0][1].text).toMatch(/Proses input manual multi-link dimulai/);
    expect(mockEnqueueSend.mock.calls[1][1].text).toMatch(/• Instagram berhasil: 1/);
    expect(mockEnqueueSend.mock.calls[1][1].text).toMatch(/• TikTok berhasil: 0/);
    expect(mockEnqueueSend.mock.calls[2][1].text).toMatch(/Sebagian link gagal diproses/);
    expect(mockEnqueueSend.mock.calls[2][1].text).toMatch(/https:\/\/tiktok.com\/video\/456/);
  });
});
