import { EventEmitter } from "events";
import { jest } from "@jest/globals";

function createClientStub() {
  const emitter = new EventEmitter();
  emitter.connect = jest.fn();
  emitter.disconnect = jest.fn();
  emitter.sendMessage = jest.fn().mockResolvedValue("mock-id");
  emitter.waitForWaReady = jest.fn().mockResolvedValue();
  emitter.onDisconnect = (handler) => {
    emitter.on("disconnected", handler);
  };
  emitter.getState = jest.fn().mockResolvedValue("open");
  emitter.sendSeen = jest.fn().mockResolvedValue();
  emitter.getContact = jest.fn().mockResolvedValue(null);
  emitter.getChatById = jest.fn().mockResolvedValue({});
  emitter.isReady = jest.fn().mockReturnValue(true);
  emitter.initialize = jest.fn().mockResolvedValue();
  emitter.once = emitter.once.bind(emitter);
  emitter.on = emitter.on.bind(emitter);
  emitter.emit = emitter.emit.bind(emitter);
  return emitter;
}

describe("waService legacy commands", () => {
  const originalSkipInit = process.env.WA_SERVICE_SKIP_INIT;

  afterAll(() => {
    if (originalSkipInit === undefined) {
      delete process.env.WA_SERVICE_SKIP_INIT;
    } else {
      process.env.WA_SERVICE_SKIP_INIT = originalSkipInit;
    }
  });

  test("returns tidak didukung message for legacy commands", async () => {
    jest.resetModules();
    process.env.WA_SERVICE_SKIP_INIT = "true";

    jest.unstable_mockModule("../src/service/baileysAdapter.js", () => ({
      createBaileysClient: jest.fn(() => createClientStub()),
    }));

    jest.unstable_mockModule("../src/service/waAutoComplaintService.js", () => ({
      handleComplaintMessageIfApplicable: jest.fn().mockResolvedValue(false),
      shouldHandleComplaintMessage: jest.fn(),
      isGatewayComplaintForward: jest.fn(),
    }));

    jest.unstable_mockModule("../src/service/waEventAggregator.js", () => ({
      handleIncoming: jest.fn(),
    }));

    jest.unstable_mockModule("../src/db/index.js", () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }));
    jest.unstable_mockModule("../src/config/env.js", () => ({ env: { GATEWAY_WA_CLIENT_ID: "gateway-client" } }));
    jest.unstable_mockModule("../src/service/clientService.js", () => ({}));
    jest.unstable_mockModule("../src/model/userModel.js", () => ({ findUserByWhatsApp: jest.fn(), getUsersByClient: jest.fn() }));
    jest.unstable_mockModule("../src/model/clientModel.js", () => ({ findByOperator: jest.fn(), findBySuperAdmin: jest.fn() }));
    jest.unstable_mockModule("../src/service/satbinmasOfficialAccountService.js", () => ({ listSatbinmasOfficialAccounts: jest.fn().mockResolvedValue([]) }));
    jest.unstable_mockModule("../src/service/premiumService.js", () => ({}));
    jest.unstable_mockModule("../src/model/premiumRequestModel.js", () => ({}));
    jest.unstable_mockModule("../src/service/userMigrationService.js", () => ({ migrateUsersFromFolder: jest.fn() }));
    jest.unstable_mockModule("../src/service/checkGoogleSheetAccess.js", () => ({ checkGoogleSheetCsvStatus: jest.fn() }));
    jest.unstable_mockModule("../src/service/importUsersFromGoogleSheet.js", () => ({ importUsersFromGoogleSheet: jest.fn() }));
    jest.unstable_mockModule("../src/handler/fetchpost/instaFetchPost.js", () => ({ fetchAndStoreInstaContent: jest.fn() }));
    jest.unstable_mockModule("../src/handler/fetchengagement/fetchLikesInstagram.js", () => ({ handleFetchLikesInstagram: jest.fn() }));
    jest.unstable_mockModule("../src/handler/fetchpost/tiktokFetchPost.js", () => ({ getTiktokSecUid: jest.fn(), fetchAndStoreTiktokContent: jest.fn() }));
    jest.unstable_mockModule("../src/service/instagramApi.js", () => ({ fetchInstagramProfile: jest.fn() }));
    jest.unstable_mockModule("../src/service/tiktokRapidService.js", () => ({ fetchTiktokProfile: jest.fn(), fetchTiktokInfo: jest.fn(), fetchTiktokPosts: jest.fn(), fetchTiktokPostsBySecUid: jest.fn(), fetchTiktokCommentsPage: jest.fn(), fetchTiktokPostDetail: jest.fn(), fetchAllTiktokComments: jest.fn() }));
    jest.unstable_mockModule("../src/service/googleContactsService.js", () => ({ saveContactIfNew: jest.fn(), authorize: jest.fn(), searchByNumbers: jest.fn(), saveGoogleContact: jest.fn() }));
    jest.unstable_mockModule("../src/handler/fetchabsensi/insta/absensiLikesInsta.js", () => ({ absensiLikes: jest.fn(), absensiLikesPerKonten: jest.fn() }));
    jest.unstable_mockModule("../src/handler/fetchabsensi/tiktok/absensiKomentarTiktok.js", () => ({ absensiKomentar: jest.fn(), absensiKomentarTiktokPerKonten: jest.fn() }));
    jest.unstable_mockModule("../src/model/instaLikeModel.js", () => ({ getLikesByShortcode: jest.fn() }));
    jest.unstable_mockModule("../src/model/instaPostModel.js", () => ({ getShortcodesTodayByClient: jest.fn() }));

    const sessions = new Map();
    jest.unstable_mockModule("../src/utils/sessionsHelper.js", () => ({
      userMenuContext: {},
      updateUsernameSession: {},
      userRequestLinkSessions: {},
      waBindSessions: {},
      operatorOptionSessions: {},
      adminOptionSessions: {},
      setSession: jest.fn((chatId, payload) => sessions.set(chatId, payload)),
      getSession: jest.fn((chatId) => sessions.get(chatId)),
      clearSession: jest.fn((chatId) => sessions.delete(chatId)),
    }));

    jest.unstable_mockModule("../src/utils/waHelper.js", () => ({
      isAdminWhatsApp: jest.fn().mockReturnValue(false),
      formatToWhatsAppId: jest.fn((value) => value),
      formatClientData: jest.fn(),
      safeSendMessage: jest.fn(),
      getAdminWAIds: jest.fn().mockReturnValue([]),
      isUnsupportedVersionError: jest.fn(),
      sendWAReport: jest.fn(),
      sendWithClientFallback: jest.fn(),
      hasSameClientIdAsAdmin: jest.fn().mockReturnValue(false),
    }));

    const { createHandleMessage } = await import("../src/service/waService.js");

    const testClient = createClientStub();
    const handleMessage = createHandleMessage(testClient, {
      allowUserMenu: false,
      clientLabel: "[TEST]",
    });

    await handleMessage({ from: "6281@s.whatsapp.net", body: "oprrequest" });
    await handleMessage({ from: "6281@s.whatsapp.net", body: "fetchinsta#MKS01" });

    expect(testClient.sendMessage).toHaveBeenCalledTimes(2);
    expect(testClient.sendMessage.mock.calls[0][1]).toContain("tidak didukung");
    expect(testClient.sendMessage.mock.calls[1][1]).toContain("tidak didukung");
  });
});
