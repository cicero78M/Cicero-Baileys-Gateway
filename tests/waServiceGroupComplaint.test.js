import { EventEmitter } from 'events';
import { jest } from '@jest/globals';

function createClientStub() {
  const emitter = new EventEmitter();
  emitter.connect = jest.fn();
  emitter.disconnect = jest.fn();
  emitter.sendMessage = jest.fn().mockResolvedValue('mock-id');
  emitter.waitForWaReady = jest.fn().mockResolvedValue();
  emitter.onDisconnect = (handler) => {
    emitter.on('disconnected', handler);
  };
  emitter.getState = jest.fn().mockResolvedValue('open');
  emitter.sendSeen = jest.fn().mockResolvedValue();
  emitter.getContact = jest.fn().mockResolvedValue(null);
  emitter.getChatById = jest.fn().mockResolvedValue({});
  emitter.once = emitter.once.bind(emitter);
  emitter.on = emitter.on.bind(emitter);
  emitter.emit = emitter.emit.bind(emitter);
  return emitter;
}

describe('waService createHandleMessage group complaints', () => {
  const originalSkipInit = process.env.WA_SERVICE_SKIP_INIT;
  const originalAdminWhatsApp = process.env.ADMIN_WHATSAPP;

  afterAll(() => {
    if (originalSkipInit === undefined) {
      delete process.env.WA_SERVICE_SKIP_INIT;
    } else {
      process.env.WA_SERVICE_SKIP_INIT = originalSkipInit;
    }
    if (originalAdminWhatsApp === undefined) {
      delete process.env.ADMIN_WHATSAPP;
    } else {
      process.env.ADMIN_WHATSAPP = originalAdminWhatsApp;
    }
  });

  test('routes structured complaints coming from group chats', async () => {
    jest.resetModules();
    process.env.WA_SERVICE_SKIP_INIT = 'true';
    process.env.ADMIN_WHATSAPP = '987';

    const handleComplaintMock = jest
      .fn()
      .mockResolvedValue(true);

    const createClientInstances = [];
    const createWwebjsClientMock = jest.fn(() => {
      const instance = createClientStub();
      createClientInstances.push(instance);
      return instance;
    });

    jest.unstable_mockModule('../src/service/wwebjsAdapter.js', () => ({
      createWwebjsClient: createWwebjsClientMock,
    }));

    jest.unstable_mockModule('../src/service/waAutoComplaintService.js', () => ({
      handleComplaintMessageIfApplicable: handleComplaintMock,
      shouldHandleComplaintMessage: jest.fn(),
      isGatewayComplaintForward: jest.fn(),
    }));

    jest.unstable_mockModule('../src/service/waEventAggregator.js', () => ({
      handleIncoming: jest.fn(),
    }));

    jest.unstable_mockModule('../src/db/index.js', () => ({
      query: jest.fn(),
    }));

    jest.unstable_mockModule('../src/config/env.js', () => ({
      env: {
        USER_WA_CLIENT_ID: 'user-client',
        GATEWAY_WA_CLIENT_ID: 'gateway-client',
      },
    }));

    jest.unstable_mockModule('../src/service/clientService.js', () => ({}));
    jest.unstable_mockModule('../src/model/userModel.js', () => ({
      findUserByWhatsApp: jest.fn(),
      getUsersByClient: jest.fn(),
    }));
    jest.unstable_mockModule('../src/model/dashboardUserModel.js', () => ({
      findAllByWhatsApp: jest.fn().mockResolvedValue([]),
    }));
    jest.unstable_mockModule('../src/model/clientModel.js', () => ({
      findByOperator: jest.fn(),
      findBySuperAdmin: jest.fn(),
    }));
    jest.unstable_mockModule('../src/service/premiumService.js', () => ({}));
    jest.unstable_mockModule('../src/model/premiumRequestModel.js', () => ({}));
    jest.unstable_mockModule('../src/service/userMigrationService.js', () => ({
      migrateUsersFromFolder: jest.fn(),
    }));
    jest.unstable_mockModule('../src/service/checkGoogleSheetAccess.js', () => ({
      checkGoogleSheetCsvStatus: jest.fn(),
    }));
    jest.unstable_mockModule('../src/service/importUsersFromGoogleSheet.js', () => ({
      importUsersFromGoogleSheet: jest.fn(),
    }));
    jest.unstable_mockModule('../src/handler/fetchpost/instaFetchPost.js', () => ({
      fetchAndStoreInstaContent: jest.fn(),
    }));
    jest.unstable_mockModule('../src/handler/fetchengagement/fetchLikesInstagram.js', () => ({
      handleFetchLikesInstagram: jest.fn(),
    }));
    jest.unstable_mockModule('../src/handler/fetchpost/tiktokFetchPost.js', () => ({
      getTiktokSecUid: jest.fn(),
      fetchAndStoreTiktokContent: jest.fn(),
    }));
    jest.unstable_mockModule('../src/service/instagramApi.js', () => ({
      fetchInstagramProfile: jest.fn(),
    }));
    jest.unstable_mockModule('../src/service/tiktokRapidService.js', () => ({
      fetchTiktokProfile: jest.fn(),
    }));
    jest.unstable_mockModule('../src/handler/fetchabsensi/insta/absensiLikesInsta.js', () => ({
      absensiLikes: jest.fn(),
      absensiLikesPerKonten: jest.fn(),
    }));
    jest.unstable_mockModule('../src/handler/fetchabsensi/tiktok/absensiKomentarTiktok.js', () => ({
      absensiKomentar: jest.fn(),
      absensiKomentarTiktokPerKonten: jest.fn(),
    }));
    jest.unstable_mockModule('../src/model/instaLikeModel.js', () => ({
      getLikesByShortcode: jest.fn(),
      hasUserLikedBetween: jest.fn(),
      getRekapLikesByClient: jest.fn(),
    }));
    jest.unstable_mockModule('../src/model/instaPostModel.js', () => ({
      getShortcodesTodayByClient: jest.fn(),
    }));
    jest.unstable_mockModule('../src/handler/menu/userMenuHandlers.js', () => ({
      userMenuHandlers: { main: jest.fn() },
    }));
    jest.unstable_mockModule('../src/handler/menu/oprRequestHandlers.js', () => ({
      oprRequestHandlers: {},
    }));
    jest.unstable_mockModule('../src/handler/menu/dashRequestHandlers.js', () => ({
      dashRequestHandlers: {},
    }));
    jest.unstable_mockModule('../src/handler/menu/dirRequestHandlers.js', () => ({
      dirRequestHandlers: {},
    }));
    jest.unstable_mockModule('../src/handler/menu/wabotDitbinmasHandlers.js', () => ({
      wabotDitbinmasHandlers: { main: jest.fn() },
    }));
    jest.unstable_mockModule('../src/handler/fetchengagement/fetchCommentTiktok.js', () => ({
      handleFetchKomentarTiktokBatch: jest.fn(),
    }));
    jest.unstable_mockModule('../src/service/googleContactsService.js', () => ({
      saveContactIfNew: jest.fn(),
      authorize: jest.fn(),
      searchByNumbers: jest.fn(),
      saveGoogleContact: jest.fn(),
    }));

    jest.unstable_mockModule('../src/utils/constants.js', () => ({
      IG_PROFILE_REGEX: /@([\w.]+)/i,
      TT_PROFILE_REGEX: /@([\w.]+)/i,
      adminCommands: [],
      hariIndo: [],
      PRIORITY_USER_NAMES: [],
    }));

    const { createHandleMessage } = await import('../src/service/waService.js');

    // Mark client ready so handler processes messages
    const primaryClient = createClientInstances[0];
    if (primaryClient) {
      primaryClient.emit('ready');
    }

    const testClient = createClientStub();
    const handleMessage = createHandleMessage(testClient, {
      allowUserMenu: false,
      clientLabel: '[TEST]',
    });

    await handleMessage({
      from: 'group123@g.us',
      body: [
        'Pesan Komplain',
        'NRP : 123456',
        'Kendala: aplikasi tidak dapat login',
      ].join('\n'),
      author: 'admin-987@s.whatsapp.net',
      isStatus: false,
      isMyContact: null,
    });

    expect(handleComplaintMock).toHaveBeenCalledTimes(1);
    expect(handleComplaintMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        chatId: 'group123@g.us',
        text: expect.stringContaining('Pesan Komplain'),
      })
    );
  });
});

