// =======================
// IMPORTS & KONFIGURASI
// =======================
import qrcode from "qrcode-terminal";
import PQueue from "p-queue";
import dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";
import { query } from "../db/index.js";
import { env } from "../config/env.js";
const pool = { query };

// WhatsApp client using Baileys
import { createBaileysClient } from "./baileysAdapter.js";
import { handleIncoming } from "./waEventAggregator.js";
import {
  logWaServiceDiagnostics,
  checkMessageListenersAttached,
} from "../utils/waDiagnostics.js";

// Service & Utility Imports
import * as clientService from "./clientService.js";
import * as userModel from "../model/userModel.js";
import * as satbinmasOfficialAccountService from "./satbinmasOfficialAccountService.js";
import { findByOperator, findBySuperAdmin } from "../model/clientModel.js";
import * as premiumService from "./premiumService.js";
import * as premiumReqModel from "../model/premiumRequestModel.js";
import { migrateUsersFromFolder } from "./userMigrationService.js";
import { checkGoogleSheetCsvStatus } from "./checkGoogleSheetAccess.js";
import { importUsersFromGoogleSheet } from "./importUsersFromGoogleSheet.js";
import { fetchAndStoreInstaContent } from "../handler/fetchpost/instaFetchPost.js";
import { handleFetchLikesInstagram } from "../handler/fetchengagement/fetchLikesInstagram.js";
import {
  getTiktokSecUid,
  fetchAndStoreTiktokContent,
} from "../handler/fetchpost/tiktokFetchPost.js";
import { fetchInstagramProfile } from "./instagramApi.js";
import { fetchTiktokProfile } from "./tiktokRapidService.js";
import {
  saveContactIfNew,
  authorize,
  searchByNumbers,
  saveGoogleContact,
} from "./googleContactsService.js";

import {
  absensiLikes,
  absensiLikesPerKonten,
} from "../handler/fetchabsensi/insta/absensiLikesInsta.js";

import {
  absensiKomentar,
  absensiKomentarTiktokPerKonten,
} from "../handler/fetchabsensi/tiktok/absensiKomentarTiktok.js";

// Model Imports
import { getLikesByShortcode } from "../model/instaLikeModel.js";
import { getShortcodesTodayByClient } from "../model/instaPostModel.js";
import { getUsersByClient } from "../model/userModel.js";

// Handler Imports
import { userMenuHandlers } from "../handler/menu/userMenuHandlers.js";
import {
  BULK_STATUS_HEADER_REGEX,
  clientRequestHandlers,
  processBulkDeletionRequest,
} from "../handler/menu/clientRequestHandlers.js";
import { oprRequestHandlers } from "../handler/menu/oprRequestHandlers.js";
import { dashRequestHandlers } from "../handler/menu/dashRequestHandlers.js";
import { dirRequestHandlers } from "../handler/menu/dirRequestHandlers.js";
import { wabotDitbinmasHandlers } from "../handler/menu/wabotDitbinmasHandlers.js";

import { handleFetchKomentarTiktokBatch } from "../handler/fetchengagement/fetchCommentTiktok.js";

// >>> HANYA SATU INI <<< (Pastikan di helper semua diekspor)
import {
  userMenuContext,
  updateUsernameSession,
  userRequestLinkSessions,
  knownUserSet,
  setMenuTimeout,
  waBindSessions,
  setBindTimeout,
  operatorOptionSessions,
  setOperatorOptionTimeout,
  adminOptionSessions,
  setAdminOptionTimeout,
  setUserRequestLinkTimeout,
  setSession,
  getSession,
  clearSession,
} from "../utils/sessionsHelper.js";

import {
  formatNama,
  groupByDivision,
  sortDivisionKeys,
  normalizeKomentarArr,
  getGreeting,
  formatUserData,
} from "../utils/utilsHelper.js";
import {
  handleComplaintMessageIfApplicable,
  isGatewayComplaintForward,
} from "./waAutoComplaintService.js";
import {
  isAdminWhatsApp,
  formatToWhatsAppId,
  formatClientData,
  safeSendMessage,
  getAdminWAIds,
  isUnsupportedVersionError,
  sendWAReport,
  sendWithClientFallback,
  hasSameClientIdAsAdmin,
} from "../utils/waHelper.js";
import {
  IG_PROFILE_REGEX,
  TT_PROFILE_REGEX,
  adminCommands,
} from "../utils/constants.js";

dotenv.config();

const debugLoggingEnabled = process.env.WA_DEBUG_LOGGING === "true";
const LOG_RATE_LIMIT_WINDOW_MS = 60000;
const rateLimitedLogState = new Map();

function buildWaStructuredLog({
  clientId = null,
  label = "WA-SERVICE",
  event,
  jid = null,
  messageId = null,
  errorCode = null,
  ...extra
}) {
  return {
    clientId,
    label,
    event,
    jid,
    messageId,
    errorCode,
    ...extra,
  };
}

function writeWaStructuredLog(level, payload, options = {}) {
  if (options.debugOnly && !debugLoggingEnabled) {
    return;
  }
  const message = JSON.stringify(payload);
  if (level === "debug") {
    console.debug(message);
    return;
  }
  if (level === "warn") {
    console.warn(message);
    return;
  }
  if (level === "error") {
    console.error(message);
    return;
  }
  console.info(message);
}

function writeRateLimitedWaWarn(rateKey, payload) {
  const now = Date.now();
  const previous = rateLimitedLogState.get(rateKey);
  if (previous && now - previous < LOG_RATE_LIMIT_WINDOW_MS) {
    return;
  }
  rateLimitedLogState.set(rateKey, now);
  writeWaStructuredLog("warn", payload);
}

const messageQueues = new WeakMap();
const sendFailureMetrics = new Map();
const clientMessageHandlers = new Map();

const shouldInitWhatsAppClients = process.env.WA_SERVICE_SKIP_INIT !== "true";
const missingChromeRemediationHint =
  'Set WA_PUPPETEER_EXECUTABLE_PATH or run "npx puppeteer browsers install chrome" to populate the Puppeteer cache.';
if (!shouldInitWhatsAppClients) {
  const isTestEnv = process.env.NODE_ENV === "test";
  const expectsMessages = process.env.WA_EXPECT_MESSAGES === "true";
  const skipInitMessage =
    "[WA] WA_SERVICE_SKIP_INIT=true; message listeners will not be attached and the bot will not receive chats.";

  if (!isTestEnv || expectsMessages) {
    const failFastMessage = `${skipInitMessage} Refusing to start because this environment is expected to receive messages.`;
    console.error(failFastMessage);
    throw new Error(failFastMessage);
  }

  console.warn(skipInitMessage);
}

// Fixed delay to ensure consistent 3-second response timing
const responseDelayMs = 3000;

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function isFatalMissingChrome(client) {
  return (
    client?.fatalInitError?.type === "missing-chrome" ||
    client?.fatalInitError?.error?.isMissingChromeError === true
  );
}

function registerClientMessageHandler(client, fromAdapter, handler) {
  if (!client || typeof handler !== "function") {
    return;
  }
  clientMessageHandlers.set(client, { fromAdapter, handler });
}

// Helper ringkas untuk menampilkan data user
function formatUserSummary(user) {
  const polresName = user.client_name || user.client_id || "-";
  return (
    "👤 *Identitas Anda*\n" +
    `*Nama Polres*: ${polresName}\n` +
    `*Nama*     : ${user.nama || "-"}\n` +
    `*Pangkat*  : ${user.title || "-"}\n` +
    `*NRP/NIP*  : ${user.user_id || "-"}\n` +
    `*Satfung*  : ${user.divisi || "-"}\n` +
    `*Jabatan*  : ${user.jabatan || "-"}\n` +
    (user.ditbinmas ? `*Desa Binaan* : ${user.desa || "-"}\n` : "") +
    `*Instagram*: ${user.insta ? "@" + user.insta.replace(/^@/, "") : "-"}\n` +
    `*TikTok*   : ${user.tiktok || "-"}\n` +
    `*Status*   : ${
      user.status === true || user.status === "true" ? "🟢 AKTIF" : "🔴 NONAKTIF"
    }`
  ).trim();
}

const numberFormatter = new Intl.NumberFormat("id-ID");

function formatCount(value) {
  return numberFormatter.format(Math.max(0, Math.floor(Number(value) || 0)));
}

function formatCurrencyId(value) {
  if (value === null || value === undefined) return "-";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return `Rp ${numberFormatter.format(numeric)}`;
}

async function startAdminOprRequestSelection({
  chatId,
  waClient,
  clientLabel,
}) {
  const orgClients = await clientService.findAllClientsByType("org");
  const availableClients = (orgClients || [])
    .filter((client) => client?.client_id)
    .map((client) => ({
      client_id: String(client.client_id).toUpperCase(),
      nama: client.nama || client.client_id,
    }));

  if (availableClients.length === 0) {
    await waClient.sendMessage(
      chatId,
      "❌ Tidak ada client bertipe Org yang tersedia untuk menu operator."
    );
    return false;
  }

  setSession(chatId, {
    menu: "oprrequest",
    step: "choose_client",
    opr_clients: availableClients,
  });

  await runMenuHandler({
    handlers: oprRequestHandlers,
    menuName: "oprrequest",
    session: getSession(chatId),
    chatId,
    text: "",
    waClient,
    clientLabel,
    args: [pool, userModel],
    invalidStepMessage:
      "⚠️ Sesi menu operator tidak dikenali. Ketik *oprrequest* ulang atau *batal*.",
    failureMessage:
      "❌ Terjadi kesalahan pada menu operator. Ketik *oprrequest* ulang untuk memulai kembali.",
  });
  return true;
}

async function runMenuHandler({
  handlers,
  menuName,
  session,
  chatId,
  text,
  waClient,
  args = [],
  clientLabel = "[WA]",
  invalidStepMessage,
  failureMessage,
}) {
  const step = session?.step || "main";
  const handler = handlers[step];
  if (typeof handler !== "function") {
    clearSession(chatId);
    await safeSendMessage(
      waClient,
      chatId,
      invalidStepMessage ||
        `⚠️ Sesi menu ${menuName} tidak dikenali. Ketik *${menuName}* ulang atau *batal*.`
    );
    return false;
  }

  try {
    await handler(session, chatId, text, waClient, ...args);
    return true;
  } catch (err) {
    console.error(
      `${clientLabel} ${menuName} handler failed (step=${step}): ${err?.stack || err}`
    );
    clearSession(chatId);
    await safeSendMessage(
      waClient,
      chatId,
      failureMessage ||
        `❌ Terjadi kesalahan pada menu ${menuName}. Silakan ketik *${menuName}* ulang.`
    );
    return true;
  }
}

function formatDateTimeId(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Jakarta",
    }).format(new Date(value));
  } catch (err) {
    return String(value);
  }
}

function normalizeInstagramUsername(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(/^@+/, "").toLowerCase();
  return normalized && /^[a-z0-9._]{1,30}$/.test(normalized) ? normalized : null;
}

function normalizeTiktokUsername(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(/^@+/, "").toLowerCase();
  return normalized && /^[a-z0-9._]{1,24}$/.test(normalized) ? normalized : null;
}

function formatSocialUsername(platform, username) {
  const normalized =
    platform === "instagram"
      ? normalizeInstagramUsername(username)
      : normalizeTiktokUsername(username);
  return normalized ? `@${normalized}` : "-";
}

function extractProfileUsername(text) {
  if (!text) return null;
  const trimmed = text.trim();
  let match = trimmed.match(IG_PROFILE_REGEX);
  if (match) {
    const username = normalizeInstagramUsername(match[2]);
    if (!username) return null;
    return {
      platform: "instagram",
      normalized: username,
      storeValue: username,
      display: formatSocialUsername("instagram", username),
    };
  }
  match = trimmed.match(TT_PROFILE_REGEX);
  if (match) {
    const username = normalizeTiktokUsername(match[2]);
    if (!username) return null;
    return {
      platform: "tiktok",
      normalized: username,
      storeValue: `@${username}`,
      display: formatSocialUsername("tiktok", username),
    };
  }
  return null;
}

const QUICK_REPLY_STEPS = new Set([
  "inputUserId",
  "confirmBindUser",
  "confirmBindUpdate",
  "updateAskField",
  "updateAskValue",
]);

function shouldExpectQuickReply(session) {
  if (!session || session.exit) {
    return false;
  }
  return session.step ? QUICK_REPLY_STEPS.has(session.step) : false;
}

function toNumeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    const num = Number(cleaned);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

function getPlatformLabel(platform) {
  return platform === "instagram" ? "Instagram" : "TikTok";
}

async function verifyInstagramAccount(username) {
  try {
    const profile = await fetchInstagramProfile(username);
    if (!profile) {
      return { active: false };
    }
    const followerCount = toNumeric(
      profile.followers_count ??
        profile.follower_count ??
        profile.followers ??
        profile.followersCount ??
        profile.edge_followed_by?.count
    );
    const followingCount = toNumeric(
      profile.following_count ??
        profile.following ??
        profile.followingCount ??
        profile.edge_follow?.count
    );
    const postCount = toNumeric(
      profile.media_count ??
        profile.posts_count ??
        profile.post_count ??
        profile.edge_owner_to_timeline_media?.count
    );
    const active = followerCount > 0 && followingCount > 0 && postCount > 0;
    return { active, followerCount, followingCount, postCount, profile };
  } catch (error) {
    return { active: false, error };
  }
}

async function verifyTiktokAccount(username) {
  try {
    const profile = await fetchTiktokProfile(username);
    if (!profile) {
      return { active: false };
    }
    const followerCount = toNumeric(
      profile.follower_count ??
        profile.followerCount ??
        profile.stats?.followerCount
    );
    const followingCount = toNumeric(
      profile.following_count ??
        profile.followingCount ??
        profile.stats?.followingCount
    );
    const postCount = toNumeric(
      profile.video_count ??
        profile.videoCount ??
        profile.stats?.videoCount
    );
    const active = followerCount > 0 && followingCount > 0 && postCount > 0;
    return { active, followerCount, followingCount, postCount, profile };
  } catch (error) {
    return { active: false, error };
  }
}

async function verifySocialAccount(platform, username) {
  if (!username) return { active: false };
  if (platform === "instagram") {
    return verifyInstagramAccount(username);
  }
  return verifyTiktokAccount(username);
}

function formatVerificationSummary(
  context,
  platform,
  displayUsername,
  verification
) {
  if (!displayUsername) {
    return `• ${context}: belum ada username ${getPlatformLabel(platform)} yang tersimpan.`;
  }
  if (!verification) {
    return `• ${context}: ${displayUsername} → belum diperiksa.`;
  }
  if (verification.error) {
    const reason = verification.error?.message || String(verification.error);
    return `• ${context}: ${displayUsername} → gagal diperiksa (${reason}).`;
  }
  if (!verification.active) {
    return `• ${context}: ${displayUsername} → belum terbaca aktif.`;
  }
  return (
    `• ${context}: ${displayUsername} → aktif ` +
    `(Postingan: ${formatCount(verification.postCount)}, ` +
    `Follower: ${formatCount(verification.followerCount)}, ` +
    `Following: ${formatCount(verification.followingCount)})`
  );
}

// =======================
// INISIALISASI CLIENT WA
// =======================

const DEFAULT_AUTH_DATA_PARENT_DIR = ".cicero";
const DEFAULT_AUTH_DATA_DIR = "wwebjs_auth";
const defaultUserClientId = "wa-userrequest";
const defaultGatewayClientId = "wa-gateway";
const rawUserClientId = String(env.USER_WA_CLIENT_ID || "");
const rawGatewayClientId = String(env.GATEWAY_WA_CLIENT_ID || "");
const normalizedUserClientId = rawUserClientId.trim();
const normalizedUserClientIdLower = normalizedUserClientId.toLowerCase();
const trimmedGatewayClientId = rawGatewayClientId.trim();
const normalizedGatewayClientId = trimmedGatewayClientId.toLowerCase();
const resolvedGatewayClientId = normalizedGatewayClientId || undefined;
const resolveAuthDataPath = () => {
  const configuredPath = String(process.env.WA_AUTH_DATA_PATH || "").trim();
  if (configuredPath) {
    return path.resolve(configuredPath);
  }
  const homeDir = os.homedir?.();
  const baseDir = homeDir || process.cwd();
  return path.resolve(
    path.join(baseDir, DEFAULT_AUTH_DATA_PARENT_DIR, DEFAULT_AUTH_DATA_DIR)
  );
};
const findSessionCaseMismatch = (authDataPath, clientId) => {
  if (!authDataPath || !clientId) {
    return null;
  }
  try {
    const entries = fs.readdirSync(authDataPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (!entry.name.startsWith("session-")) {
        continue;
      }
      const existingClientId = entry.name.slice("session-".length);
      if (
        existingClientId &&
        existingClientId.toLowerCase() === clientId &&
        existingClientId !== clientId
      ) {
        return path.join(authDataPath, entry.name);
      }
    }
  } catch (err) {
    console.warn(
      `[WA] Gagal memeriksa folder session di ${authDataPath}:`,
      err?.message || err
    );
  }
  return null;
};

const throwClientIdError = (message) => {
  throw new Error(`[WA] ${message}`);
};

const ensureUserClientIdConsistency = () => {
  const authDataPath = resolveAuthDataPath();
  if (!normalizedUserClientIdLower) {
    throwClientIdError(
      "USER_WA_CLIENT_ID kosong; set nilai unik lowercase (contoh: wa-userrequest-prod)."
    );
  }
  if (
    normalizedUserClientId &&
    normalizedUserClientIdLower &&
    normalizedUserClientId !== normalizedUserClientIdLower
  ) {
    const sessionPath = findSessionCaseMismatch(
      authDataPath,
      normalizedUserClientIdLower
    );
    const sessionHint = sessionPath
      ? ` Ditemukan session berbeda di ${sessionPath}.`
      : "";
    throwClientIdError(
      `USER_WA_CLIENT_ID harus lowercase. Nilai "${normalizedUserClientId}" tidak konsisten.${sessionHint} ` +
        "Perbarui env/folder session agar cocok sebelum menjalankan proses."
    );
  }
  if (normalizedUserClientIdLower === defaultUserClientId) {
    throwClientIdError(
      `USER_WA_CLIENT_ID masih default (${defaultUserClientId}); clientId harus unik dan lowercase. ` +
        `Perbarui env dan bersihkan session lama di ${authDataPath}.`
    );
  }
  const mismatchedSessionPath = findSessionCaseMismatch(
    authDataPath,
    normalizedUserClientIdLower
  );
  if (mismatchedSessionPath) {
    throwClientIdError(
      `Folder session "${path.basename(mismatchedSessionPath)}" tidak konsisten dengan ` +
        `USER_WA_CLIENT_ID="${normalizedUserClientIdLower}". Rename atau hapus session lama di ` +
        `${mismatchedSessionPath} agar konsisten.`
    );
  }
};

const ensureGatewayClientIdConsistency = () => {
  const authDataPath = resolveAuthDataPath();
  if (
    trimmedGatewayClientId &&
    normalizedGatewayClientId &&
    trimmedGatewayClientId !== normalizedGatewayClientId
  ) {
    const sessionPath = findSessionCaseMismatch(
      authDataPath,
      normalizedGatewayClientId
    );
    const sessionHint = sessionPath
      ? ` Ditemukan session berbeda di ${sessionPath}.`
      : "";
    throwClientIdError(
      `GATEWAY_WA_CLIENT_ID harus lowercase. Nilai "${trimmedGatewayClientId}" tidak konsisten.${sessionHint} ` +
        "Perbarui env/folder session agar cocok sebelum menjalankan proses."
    );
  }
  if (normalizedGatewayClientId === defaultGatewayClientId) {
    throwClientIdError(
      `GATEWAY_WA_CLIENT_ID masih default (${defaultGatewayClientId}); clientId harus unik dan lowercase. ` +
        `Perbarui env dan bersihkan session lama di ${authDataPath}.`
    );
  }
  const mismatchedSessionPath = findSessionCaseMismatch(
    authDataPath,
    normalizedGatewayClientId
  );
  if (mismatchedSessionPath) {
    throwClientIdError(
      `Folder session "${path.basename(mismatchedSessionPath)}" tidak konsisten dengan ` +
        `GATEWAY_WA_CLIENT_ID="${normalizedGatewayClientId}". Rename atau hapus session lama di ` +
        `${mismatchedSessionPath} agar konsisten.`
    );
  }
};

const ensureClientIdUniqueness = () => {
  if (normalizedUserClientIdLower === normalizedGatewayClientId) {
    throwClientIdError(
      `USER_WA_CLIENT_ID dan GATEWAY_WA_CLIENT_ID sama (${normalizedGatewayClientId}); ` +
        "clientId harus unik. Perbarui env sebelum menjalankan proses."
    );
  }
};

ensureUserClientIdConsistency();
ensureGatewayClientIdConsistency();
ensureClientIdUniqueness();

// Initialize WhatsApp client via Baileys
export let waClient = await createBaileysClient();
export let waUserClient = await createBaileysClient(env.USER_WA_CLIENT_ID);
export let waGatewayClient = await createBaileysClient(resolvedGatewayClientId);

const logClientIdIssue = (envVar, issueMessage) => {
  console.error(`[WA] ${envVar} ${issueMessage}; clientId harus unik.`);
};

if (!normalizedUserClientId) {
  logClientIdIssue("USER_WA_CLIENT_ID", "kosong");
}
if (!normalizedGatewayClientId) {
  logClientIdIssue("GATEWAY_WA_CLIENT_ID", "kosong");
}
if (normalizedUserClientId === defaultUserClientId) {
  logClientIdIssue(
    "USER_WA_CLIENT_ID",
    `masih default (${defaultUserClientId})`
  );
}
if (normalizedGatewayClientId === defaultGatewayClientId) {
  logClientIdIssue(
    "GATEWAY_WA_CLIENT_ID",
    `masih default (${defaultGatewayClientId})`
  );
}
if (
  normalizedUserClientId &&
  normalizedGatewayClientId &&
  normalizedUserClientId === normalizedGatewayClientId
) {
  console.error(
    `[WA] USER_WA_CLIENT_ID dan GATEWAY_WA_CLIENT_ID sama (${normalizedUserClientId}); ` +
      "clientId harus unik."
  );
}

const clientReadiness = new Map();
const adminNotificationQueue = [];
const readinessDiagnosticsIntervalMs = Math.max(
  30000,
  Number(process.env.WA_READINESS_DIAGNOSTIC_INTERVAL_MS) || 120000
);
const defaultReadyTimeoutMs = Number.isNaN(
  Number(process.env.WA_READY_TIMEOUT_MS)
)
  ? 60000
  : Number(process.env.WA_READY_TIMEOUT_MS);
const gatewayReadyTimeoutMs = Number.isNaN(
  Number(process.env.WA_GATEWAY_READY_TIMEOUT_MS)
)
  ? defaultReadyTimeoutMs
  : Number(process.env.WA_GATEWAY_READY_TIMEOUT_MS);
const lifecycleEventInFlight = new WeakMap();
const lifecycleEventQueued = new WeakMap();
const logoutDisconnectReasons = new Set([
  "LOGGED_OUT",
  "UNPAIRED",
  "CONFLICT",
  "UNPAIRED_IDLE",
]);

function getClientReadyTimeoutMs(client) {
  const clientOverride = client?.readyTimeoutMs;
  if (typeof clientOverride === "number" && !Number.isNaN(clientOverride)) {
    return clientOverride;
  }
  if (client === waGatewayClient) {
    return gatewayReadyTimeoutMs;
  }
  return defaultReadyTimeoutMs;
}

function getClientReadinessState(client, label = "WA") {
  if (!clientReadiness.has(client)) {
    clientReadiness.set(client, {
      label,
      ready: false,
      lastLifecycleEvent: "initialized",
      lastLifecycleAt: Date.now(),
      pendingMessages: [],
      readyResolvers: [],
      awaitingQrScan: false,
      lastDisconnectReason: null,
      lastAuthFailureAt: null,
      lastAuthFailureMessage: null,
      lastQrAt: null,
      lastQrPayloadSeen: null,
    });
  }
  return clientReadiness.get(client);
}

function normalizeDisconnectReason(reason) {
  return String(reason || "").trim().toUpperCase();
}

function isLogoutDisconnectReason(reason) {
  const normalizedReason = normalizeDisconnectReason(reason);
  return logoutDisconnectReasons.has(normalizedReason);
}

function clearLogoutAwaitingQr(client) {
  const state = getClientReadinessState(client);
  if (state.awaitingQrScan || state.lastDisconnectReason) {
    state.awaitingQrScan = false;
    state.lastDisconnectReason = null;
  }
}

function setClientNotReady(client, eventName = "unknown") {
  const state = getClientReadinessState(client);
  if (state.ready) {
    writeRateLimitedWaWarn(
      `not-ready:${state.label}:${eventName}`,
      buildWaStructuredLog({
        clientId: client?.clientId || null,
        label: state.label,
        event: "wa_client_not_ready",
        errorCode: eventName,
      })
    );
  }
  state.ready = false;
  state.lastLifecycleEvent = eventName;
  state.lastLifecycleAt = Date.now();
}

function registerClientReadiness(client, label) {
  getClientReadinessState(client, label);
}

function runSingleLifecycleTransition(client, label, eventName, reason, transitionHandler) {
  if (lifecycleEventInFlight.get(client)) {
    const queuedEvent = lifecycleEventQueued.get(client);
    const currentReason = reason ?? null;
    if (queuedEvent?.eventName !== eventName || queuedEvent?.reason !== currentReason) {
      lifecycleEventQueued.set(client, { eventName, reason: currentReason });
      writeWaStructuredLog(
        "debug",
        buildWaStructuredLog({
          clientId: client?.clientId || null,
          label,
          event: "wa_lifecycle_transition_queued",
          errorCode: eventName,
          reason: currentReason,
        }),
        { debugOnly: true }
      );
    }
    return;
  }

  lifecycleEventInFlight.set(client, true);
  Promise.resolve()
    .then(transitionHandler)
    .catch((error) => {
      writeWaStructuredLog(
        "error",
        buildWaStructuredLog({
          clientId: client?.clientId || null,
          label,
          event: "wa_lifecycle_transition_failed",
          errorCode: eventName,
          errorMessage: error?.message || String(error),
        })
      );
    })
    .finally(() => {
      lifecycleEventInFlight.set(client, false);
      const queuedEvent = lifecycleEventQueued.get(client);
      if (!queuedEvent) {
        return;
      }
      lifecycleEventQueued.delete(client);
      runSingleLifecycleTransition(
        client,
        label,
        queuedEvent.eventName,
        queuedEvent.reason,
        () => {
          if (queuedEvent.eventName === "auth_failure") {
            const state = getClientReadinessState(client, label);
            state.lastAuthFailureAt = Date.now();
            state.lastAuthFailureMessage = queuedEvent.reason || null;
            setClientNotReady(client);
            writeWaStructuredLog(
              "warn",
              buildWaStructuredLog({
                clientId: client?.clientId || null,
                label,
                event: "auth_failure",
                errorCode: "AUTH_FAILURE",
                errorMessage: queuedEvent.reason || null,
              })
            );
            return;
          }
          if (queuedEvent.eventName === "disconnected") {
            const normalizedReason = normalizeDisconnectReason(queuedEvent.reason);
            const shouldAwaitQr = isLogoutDisconnectReason(normalizedReason);
            const state = getClientReadinessState(client, label);
            state.lastDisconnectReason = normalizedReason || null;
            state.awaitingQrScan = shouldAwaitQr;
            setClientNotReady(client);
            writeWaStructuredLog(
              "warn",
              buildWaStructuredLog({
                clientId: client?.clientId || null,
                label,
                event: "disconnected",
                errorCode: normalizedReason || null,
              })
            );
          }
        }
      );
    });
}

function flushPendingMessages(client) {
  const state = getClientReadinessState(client);
  if (state.pendingMessages.length) {
    writeWaStructuredLog(
      "debug",
      buildWaStructuredLog({
        clientId: client?.clientId || null,
        label: state.label,
        event: "wa_deferred_messages_processing",
        pendingMessages: state.pendingMessages.length,
      }),
      { debugOnly: true }
    );
    const handlerInfo = clientMessageHandlers.get(client);
    state.pendingMessages.splice(0).forEach((pending) => {
      const entry =
        pending && typeof pending === "object" && "msg" in pending
          ? pending
          : { msg: pending, allowReplay: false };
      const deferredMsg = entry.msg;
      const allowReplay = Boolean(entry.allowReplay);
      writeWaStructuredLog(
        "debug",
        buildWaStructuredLog({
          clientId: client?.clientId || null,
          label: state.label,
          event: "wa_deferred_message_replayed",
          jid: deferredMsg?.from || null,
          messageId: deferredMsg?.id?._serialized || deferredMsg?.id?.id || null,
        }),
        { debugOnly: true }
      );
      if (!handlerInfo?.handler) {
        writeRateLimitedWaWarn(
          `missing-handler:${state.label}`,
          buildWaStructuredLog({
            clientId: client?.clientId || null,
            label: state.label,
            event: "wa_missing_deferred_handler",
            errorCode: "MISSING_HANDLER",
          })
        );
        return;
      }
      handleIncoming(handlerInfo.fromAdapter, deferredMsg, handlerInfo.handler, {
        allowReplay,
      });
    });
  }
}

function markClientReady(client, src = "unknown") {
  clearLogoutAwaitingQr(client);
  const state = getClientReadinessState(client);
  state.lastLifecycleEvent = src;
  state.lastLifecycleAt = Date.now();
  if (!state.ready) {
    state.ready = true;
    writeWaStructuredLog(
      "info",
      buildWaStructuredLog({
        clientId: client?.clientId || null,
        label: state.label,
        event: "ready",
        errorCode: src,
      })
    );
    state.readyResolvers.splice(0).forEach((resolve) => resolve());
  }
  if (state.lastAuthFailureAt) {
    state.lastAuthFailureAt = null;
    state.lastAuthFailureMessage = null;
  }
  flushPendingMessages(client);
  if (client === waClient) {
    flushAdminNotificationQueue();
  }
}

function inferClientReadyState({ readinessState, observedState }) {
  const normalizedObservedState = String(observedState || "").toLowerCase();
  const isObservedConnected =
    normalizedObservedState === "connected" || normalizedObservedState === "open";
  const lifecycleEvent = String(readinessState?.lastLifecycleEvent || "").toLowerCase();

  if (lifecycleEvent === "disconnected" || lifecycleEvent === "auth_failure") {
    return false;
  }

  if (lifecycleEvent === "ready" || lifecycleEvent === "change_state_connected" || lifecycleEvent === "change_state_open") {
    return true;
  }

  return readinessState?.ready || isObservedConnected;
}

function snapshotReadinessState({ readinessState, client, observedState = null }) {
  return {
    label: readinessState.label,
    ready: inferClientReadyState({ readinessState, observedState }),
    pendingMessages: readinessState.pendingMessages.length,
    awaitingQrScan: readinessState.awaitingQrScan,
    lastDisconnectReason: readinessState.lastDisconnectReason,
    lastAuthFailureAt: readinessState.lastAuthFailureAt
      ? new Date(readinessState.lastAuthFailureAt).toISOString()
      : null,
    lastAuthFailureMessage: readinessState.lastAuthFailureMessage,
    lastQrAt: readinessState.lastQrAt ? new Date(readinessState.lastQrAt).toISOString() : null,
    lastLifecycleEvent: readinessState.lastLifecycleEvent,
    lastLifecycleAt: readinessState.lastLifecycleAt
      ? new Date(readinessState.lastLifecycleAt).toISOString()
      : null,
    observedState,
    fatalInitError: client?.fatalInitError || null,
    puppeteerExecutablePath: client?.puppeteerExecutablePath || null,
    sessionPath: client?.sessionPath || null,
    clientId: client?.clientId || null,
  };
}

function getWaReadinessSummarySync() {
  const clientEntries = [
    { key: "wa", client: waClient, label: "WA" },
    { key: "waUser", client: waUserClient, label: "WA-USER" },
    { key: "waGateway", client: waGatewayClient, label: "WA-GATEWAY" },
  ];

  const clients = {};
  clientEntries.forEach(({ key, client, label }) => {
    const readinessState = getClientReadinessState(client, label);
    clients[key] = snapshotReadinessState({ readinessState, client });
  });

  return {
    shouldInitWhatsAppClients,
    clients,
  };
}

export async function getWaReadinessSummary() {
  const summary = getWaReadinessSummarySync();
  const clientEntries = [
    { key: "wa", client: waClient },
    { key: "waUser", client: waUserClient },
    { key: "waGateway", client: waGatewayClient },
  ];

  await Promise.all(
    clientEntries.map(async ({ key, client }) => {
      if (typeof client?.getState !== "function") return;
      try {
        const observedState = await client.getState();
        summary.clients[key] = {
          ...summary.clients[key],
          observedState,
          ready: inferClientReadyState({
            readinessState: getClientReadinessState(client),
            observedState,
          }),
        };
      } catch (error) {
        summary.clients[key] = {
          ...summary.clients[key],
          observedState: "unavailable",
          observedStateError: error?.message || String(error),
        };
      }
    })
  );

  return summary;
}

function getInitReadinessIssue({ label, client }) {
  const readinessState = getClientReadinessState(client, label);
  if (isFatalMissingChrome(client)) {
    return {
      label,
      reason: "missing Chrome executable",
      remediation: missingChromeRemediationHint,
      detail: client?.fatalInitError?.error?.message || null,
    };
  }
  if (!readinessState?.ready) {
    return {
      label,
      reason: "client is not ready",
      remediation:
        "Pastikan QR discan bila awaitingQrScan=true dan periksa WA_AUTH_DATA_PATH untuk sesi yang valid.",
      detail: readinessState?.lastDisconnectReason || null,
    };
  }
  return null;
}

function startReadinessDiagnosticsLogger() {
  setInterval(async () => {
    const summary = await getWaReadinessSummary();
    writeWaStructuredLog(
      "debug",
      buildWaStructuredLog({
        label: "WA",
        event: "wa_periodic_readiness_diagnostics",
        intervalMs: readinessDiagnosticsIntervalMs,
        clients: summary.clients,
      }),
      { debugOnly: true }
    );
  }, readinessDiagnosticsIntervalMs).unref?.();
}

registerClientReadiness(waClient, "WA");
registerClientReadiness(waUserClient, "WA-USER");
registerClientReadiness(waGatewayClient, "WA-GATEWAY");
waGatewayClient.readyTimeoutMs = gatewayReadyTimeoutMs;

export function queueAdminNotification(message) {
  adminNotificationQueue.push(message);
}

export function flushAdminNotificationQueue() {
  if (!adminNotificationQueue.length) return;
  writeWaStructuredLog(
    "debug",
    buildWaStructuredLog({
      label: "WA",
      event: "wa_admin_notifications_flush",
      queuedCount: adminNotificationQueue.length,
    }),
    { debugOnly: true }
  );
  adminNotificationQueue.splice(0).forEach((msg) => {
    for (const wa of getAdminWAIds()) {
      safeSendMessage(waClient, wa, msg);
    }
  });
}

async function waitForClientReady(client, timeoutMs) {
  const state = getClientReadinessState(client);
  if (state.ready) return;

  const formatClientReadyTimeoutContext = (readinessState) => {
    const label = readinessState?.label || "WA";
    const clientId = client?.clientId || "unknown";
    const sessionPath = client?.sessionPath || "unknown";
    const awaitingQrScan = readinessState?.awaitingQrScan ? "true" : "false";
    const lastDisconnectReason = readinessState?.lastDisconnectReason || "none";
    const lastAuthFailureAt = readinessState?.lastAuthFailureAt
      ? new Date(readinessState.lastAuthFailureAt).toISOString()
      : "none";
    return {
      label,
      clientId,
      sessionPath,
      awaitingQrScan,
      lastDisconnectReason,
      lastAuthFailureAt,
    };
  };

  return new Promise((resolve, reject) => {
    let timer;
    const resolver = () => {
      clearTimeout(timer);
      resolve();
    };
    state.readyResolvers.push(resolver);
    const resolvedTimeoutMs =
      timeoutMs === null || timeoutMs === undefined
        ? getClientReadyTimeoutMs(client)
        : Number.isNaN(Number(timeoutMs))
          ? getClientReadyTimeoutMs(client)
          : Number(timeoutMs);
    if (isFatalMissingChrome(client) || client?.fatalInitError?.type === "missing-chrome") {
      const idx = state.readyResolvers.indexOf(resolver);
      if (idx !== -1) state.readyResolvers.splice(idx, 1);
      const timeoutContext = formatClientReadyTimeoutContext(state);
      timeoutContext.remediationHint = missingChromeRemediationHint;
      const contextMessage =
        `label=${timeoutContext.label} ` +
        `clientId=${timeoutContext.clientId} ` +
        `sessionPath=${timeoutContext.sessionPath} ` +
        `awaitingQrScan=${timeoutContext.awaitingQrScan} ` +
        `lastDisconnectReason=${timeoutContext.lastDisconnectReason} ` +
        `lastAuthFailureAt=${timeoutContext.lastAuthFailureAt}`;
      const missingChromeError = new Error(
        `WhatsApp client not ready: missing Chrome executable; ${contextMessage}. ${missingChromeRemediationHint}`
      );
      missingChromeError.context = timeoutContext;
      reject(missingChromeError);
      return;
    }
    timer = setTimeout(() => {
      const idx = state.readyResolvers.indexOf(resolver);
      if (idx !== -1) state.readyResolvers.splice(idx, 1);
      const timeoutContext = formatClientReadyTimeoutContext(state);
      const missingChrome = isFatalMissingChrome(client);
      const contextMessage =
        `label=${timeoutContext.label} ` +
        `clientId=${timeoutContext.clientId} ` +
        `sessionPath=${timeoutContext.sessionPath} ` +
        `awaitingQrScan=${timeoutContext.awaitingQrScan} ` +
        `lastDisconnectReason=${timeoutContext.lastDisconnectReason} ` +
        `lastAuthFailureAt=${timeoutContext.lastAuthFailureAt}`;
      const remediationMessage =
        "Remediation: scan QR terbaru (jika awaitingQrScan=true), cek WA_AUTH_DATA_PATH, WA_PUPPETEER_EXECUTABLE_PATH.";
      console.error(
        `[${timeoutContext.label}] waitForClientReady timeout after ${resolvedTimeoutMs}ms; ${contextMessage}; ${remediationMessage}`
      );
      const waState = getClientReadinessState(waClient, "WA");
      if (waState.ready) {
        queueAdminNotification(
          `[${timeoutContext.label}] WA client not ready after ${resolvedTimeoutMs}ms. ${remediationMessage}`
        );
        flushAdminNotificationQueue();
      }
      if (missingChrome) {
        timeoutContext.remediationHint = missingChromeRemediationHint;
        const missingChromeError = new Error(
          `WhatsApp client not ready: missing Chrome executable; ${contextMessage}. ${missingChromeRemediationHint}`
        );
        missingChromeError.context = timeoutContext;
        reject(missingChromeError);
        return;
      }
      const timeoutError = new Error(
        `WhatsApp client not ready after ${resolvedTimeoutMs}ms; ${contextMessage}`
      );
      timeoutError.context = timeoutContext;
      reject(timeoutError);
    }, resolvedTimeoutMs);
  });
}

export function waitForWaReady(timeoutMs) {
  return waitForClientReady(waClient, timeoutMs);
}

// Expose readiness helper for consumers like safeSendMessage
waClient.waitForWaReady = () => waitForClientReady(waClient);
waUserClient.waitForWaReady = () => waitForClientReady(waUserClient);
waGatewayClient.waitForWaReady = () => waitForClientReady(waGatewayClient);

// Pastikan semua pengiriman pesan menunggu hingga client siap
function wrapSendMessage(client) {
  const original = client.sendMessage;
  client._originalSendMessage = original;
  let queueForClient = messageQueues.get(client);
  if (!queueForClient) {
    queueForClient = new PQueue({ concurrency: 1 });
    messageQueues.set(client, queueForClient);
  }

  function inferMessageType(messageContent) {
    if (typeof messageContent === "string") {
      return "text";
    }
    if (messageContent?.type && typeof messageContent.type === "string") {
      return messageContent.type;
    }
    if (messageContent?.mimetype) {
      return "media";
    }
    if (Buffer.isBuffer(messageContent)) {
      return "buffer";
    }
    if (messageContent === null || messageContent === undefined) {
      return "unknown";
    }
    return typeof messageContent;
  }

  function getSendFailureMetric(clientLabel) {
    if (!sendFailureMetrics.has(clientLabel)) {
      sendFailureMetrics.set(clientLabel, {
        failed: 0,
        lastFailureAt: null,
      });
    }
    return sendFailureMetrics.get(clientLabel);
  }

  async function sendOnce(args) {
    const waitFn =
      typeof client.waitForWaReady === "function"
        ? client.waitForWaReady
        : () => waitForClientReady(client);

    await waitFn().catch(() => {
      console.warn("[WA] sendMessage called before ready");
      throw new Error("WhatsApp client not ready");
    });

    const [jid, message] = args;
    const readinessState = getClientReadinessState(client);
    const clientLabel = readinessState?.label || "WA";
    const messageType = inferMessageType(message);

    try {
      return await original.apply(client, args);
    } catch (err) {
      const failureMetric = getSendFailureMetric(clientLabel);
      failureMetric.failed += 1;
      failureMetric.lastFailureAt = new Date().toISOString();

      const sendFailureMetadata = {
        jid,
        clientLabel,
        messageType,
      };

      if (err && typeof err === "object") {
        err.sendFailureMetadata = sendFailureMetadata;
      }

      console.error("[WA] sendMessage failed", {
        event: "wa_send_message_failed",
        jid,
        clientLabel,
        messageType,
        errorMessage: err?.message || String(err),
        failureMetric,
      });

      throw err;
    }
  }

  client.sendMessage = (...args) => {
    return queueForClient.add(() => sendOnce(args), {
      delay: responseDelayMs,
    });
  };
}
wrapSendMessage(waClient);
wrapSendMessage(waUserClient);
wrapSendMessage(waGatewayClient);

/**
 * Wait for all WhatsApp client message queues to be idle (empty and no pending tasks)
 * This ensures all messages have been sent before the caller continues
 */
export async function waitForAllMessageQueues() {
  const clients = [waClient, waUserClient, waGatewayClient];
  const idlePromises = [];
  
  for (const client of clients) {
    const queue = messageQueues.get(client);
    if (queue) {
      idlePromises.push(queue.onIdle());
    }
  }
  
  if (idlePromises.length > 0) {
    await Promise.all(idlePromises);
  }
}

export function sendGatewayMessage(jid, text) {
  const waFallbackClients = [
    { client: waGatewayClient, label: "WA-GATEWAY" },
    { client: waClient, label: "WA" },
    { client: waUserClient, label: "WA-USER" },
  ];
  return sendWithClientFallback({
    chatId: jid,
    message: text,
    clients: waFallbackClients,
    reportClient: waClient,
    reportContext: { source: "sendGatewayMessage", jid },
  });
}

// Handle QR code (scan)
waClient.on("qr", (qr) => {
  const state = getClientReadinessState(waClient, "WA");
  state.lastQrAt = Date.now();
  state.lastQrPayloadSeen = qr;
  state.awaitingQrScan = true;
  qrcode.generate(qr, { small: true });
  writeWaStructuredLog("debug", buildWaStructuredLog({ clientId: waClient?.clientId || null, label: "WA", event: "qr" }), { debugOnly: true });
});

waClient.on("authenticated", (session) => {
  const sessionInfo = session ? "session received" : "no session payload";
  writeWaStructuredLog("debug", buildWaStructuredLog({ clientId: waClient?.clientId || null, label: "WA", event: "authenticated", errorCode: sessionInfo }), { debugOnly: true });
  clearLogoutAwaitingQr(waClient);
});

waClient.on("auth_failure", (message) => {
  runSingleLifecycleTransition(
    waClient,
    "WA",
    "auth_failure",
    message,
    () => {
      setClientNotReady(waClient);
      const state = getClientReadinessState(waClient, "WA");
      state.lastAuthFailureAt = Date.now();
      state.lastAuthFailureMessage = message || null;
      writeWaStructuredLog("warn", buildWaStructuredLog({ clientId: waClient?.clientId || null, label: "WA", event: "auth_failure", errorCode: "AUTH_FAILURE", errorMessage: message || null }));
    }
  );
});

waClient.on("disconnected", (reason) => {
  runSingleLifecycleTransition(waClient, "WA", "disconnected", reason, () => {
    const normalizedReason = normalizeDisconnectReason(reason);
    const state = getClientReadinessState(waClient, "WA");
    state.lastDisconnectReason = normalizedReason || null;
    state.awaitingQrScan = isLogoutDisconnectReason(normalizedReason);
    setClientNotReady(waClient);
    writeWaStructuredLog("warn", buildWaStructuredLog({ clientId: waClient?.clientId || null, label: "WA", event: "disconnected", errorCode: normalizedReason || null }));
  });
});

waClient.on("ready", () => {
  clearLogoutAwaitingQr(waClient);
  markClientReady(waClient, "ready");
});

waClient.on("change_state", (state) => {
  const normalizedState = String(state || "").toLowerCase();
  if (normalizedState === "connected" || normalizedState === "open") {
    markClientReady(waClient, `change_state_${normalizedState}`);
    return;
  }
  writeRateLimitedWaWarn(
    `unknown-state:WA:${normalizedState || 'empty'}`,
    buildWaStructuredLog({
      clientId: waClient?.clientId || null,
      label: "WA",
      event: "change_state_unknown",
      errorCode: normalizedState || "UNKNOWN_STATE",
    })
  );
});

waUserClient.on("qr", (qr) => {
  const state = getClientReadinessState(waUserClient, "WA-USER");
  state.lastQrAt = Date.now();
  state.lastQrPayloadSeen = qr;
  state.awaitingQrScan = true;
  qrcode.generate(qr, { small: true });
  writeWaStructuredLog("debug", buildWaStructuredLog({ clientId: waUserClient?.clientId || null, label: "WA-USER", event: "qr" }), { debugOnly: true });
});

waUserClient.on("authenticated", (session) => {
  const sessionInfo = session ? "session received" : "no session payload";
  writeWaStructuredLog("debug", buildWaStructuredLog({ clientId: waUserClient?.clientId || null, label: "WA-USER", event: "authenticated", errorCode: sessionInfo }), { debugOnly: true });
  clearLogoutAwaitingQr(waUserClient);
});

waUserClient.on("auth_failure", (message) => {
  runSingleLifecycleTransition(
    waUserClient,
    "WA-USER",
    "auth_failure",
    message,
    () => {
      setClientNotReady(waUserClient);
      const state = getClientReadinessState(waUserClient, "WA-USER");
      state.lastAuthFailureAt = Date.now();
      state.lastAuthFailureMessage = message || null;
      writeWaStructuredLog("warn", buildWaStructuredLog({ clientId: waUserClient?.clientId || null, label: "WA-USER", event: "auth_failure", errorCode: "AUTH_FAILURE", errorMessage: message || null }));
    }
  );
});

waUserClient.on("disconnected", (reason) => {
  runSingleLifecycleTransition(
    waUserClient,
    "WA-USER",
    "disconnected",
    reason,
    () => {
      const normalizedReason = normalizeDisconnectReason(reason);
      const state = getClientReadinessState(waUserClient, "WA-USER");
      state.lastDisconnectReason = normalizedReason || null;
      state.awaitingQrScan = isLogoutDisconnectReason(normalizedReason);
      setClientNotReady(waUserClient);
      writeWaStructuredLog("warn", buildWaStructuredLog({ clientId: waUserClient?.clientId || null, label: "WA-USER", event: "disconnected", errorCode: normalizedReason || null }));
    }
  );
});

waUserClient.on("ready", () => {
  clearLogoutAwaitingQr(waUserClient);
  markClientReady(waUserClient, "ready");
});

waUserClient.on("change_state", (state) => {
  const normalizedState = String(state || "").toLowerCase();
  if (normalizedState === "connected" || normalizedState === "open") {
    markClientReady(waUserClient, `change_state_${normalizedState}`);
    return;
  }
  writeRateLimitedWaWarn(
    `unknown-state:WA-USER:${normalizedState || 'empty'}`,
    buildWaStructuredLog({
      clientId: waUserClient?.clientId || null,
      label: "WA-USER",
      event: "change_state_unknown",
      errorCode: normalizedState || "UNKNOWN_STATE",
    })
  );
});

waGatewayClient.on("qr", (qr) => {
  const state = getClientReadinessState(waGatewayClient, "WA-GATEWAY");
  state.lastQrAt = Date.now();
  state.lastQrPayloadSeen = qr;
  state.awaitingQrScan = true;
  qrcode.generate(qr, { small: true });
  writeWaStructuredLog("debug", buildWaStructuredLog({ clientId: waGatewayClient?.clientId || null, label: "WA-GATEWAY", event: "qr" }), { debugOnly: true });
});

waGatewayClient.on("authenticated", (session) => {
  const sessionInfo = session ? "session received" : "no session payload";
  writeWaStructuredLog("debug", buildWaStructuredLog({ clientId: waGatewayClient?.clientId || null, label: "WA-GATEWAY", event: "authenticated", errorCode: sessionInfo }), { debugOnly: true });
  clearLogoutAwaitingQr(waGatewayClient);
});

waGatewayClient.on("auth_failure", (message) => {
  runSingleLifecycleTransition(
    waGatewayClient,
    "WA-GATEWAY",
    "auth_failure",
    message,
    () => {
      setClientNotReady(waGatewayClient);
      const state = getClientReadinessState(waGatewayClient, "WA-GATEWAY");
      state.lastAuthFailureAt = Date.now();
      state.lastAuthFailureMessage = message || null;
      writeWaStructuredLog("warn", buildWaStructuredLog({ clientId: waGatewayClient?.clientId || null, label: "WA-GATEWAY", event: "auth_failure", errorCode: "AUTH_FAILURE", errorMessage: message || null }));
    }
  );
});

waGatewayClient.on("disconnected", (reason) => {
  runSingleLifecycleTransition(
    waGatewayClient,
    "WA-GATEWAY",
    "disconnected",
    reason,
    () => {
      const normalizedReason = normalizeDisconnectReason(reason);
      const state = getClientReadinessState(waGatewayClient, "WA-GATEWAY");
      state.lastDisconnectReason = normalizedReason || null;
      state.awaitingQrScan = isLogoutDisconnectReason(normalizedReason);
      setClientNotReady(waGatewayClient);
      writeWaStructuredLog("warn", buildWaStructuredLog({ clientId: waGatewayClient?.clientId || null, label: "WA-GATEWAY", event: "disconnected", errorCode: normalizedReason || null }));
    }
  );
});

waGatewayClient.on("ready", () => {
  clearLogoutAwaitingQr(waGatewayClient);
  markClientReady(waGatewayClient, "ready");
});

waGatewayClient.on("change_state", (state) => {
  const normalizedState = String(state || "").toLowerCase();
  if (normalizedState === "connected" || normalizedState === "open") {
    markClientReady(waGatewayClient, `change_state_${normalizedState}`);
    return;
  }
  writeRateLimitedWaWarn(
    `unknown-state:WA-GATEWAY:${normalizedState || 'empty'}`,
    buildWaStructuredLog({
      clientId: waGatewayClient?.clientId || null,
      label: "WA-GATEWAY",
      event: "change_state_unknown",
      errorCode: normalizedState || "UNKNOWN_STATE",
    })
  );
});

// =======================
// MESSAGE HANDLER UTAMA
// =======================
async function handleClientRequestSessionStep({
  session,
  chatId,
  text,
  waClient,
  clientLabel,
  pool,
  userModel,
  clientService,
  migrateUsersFromFolder,
  checkGoogleSheetCsvStatus,
  importUsersFromGoogleSheet,
  fetchAndStoreInstaContent,
  fetchAndStoreTiktokContent,
  formatClientData,
  handleFetchLikesInstagram,
  handleFetchKomentarTiktokBatch,
}) {
  if (!session || session.menu !== "clientrequest") {
    return false;
  }

  if ((text || "").toLowerCase() === "batal") {
    clearSession(chatId);
    await safeSendMessage(waClient, chatId, "✅ Menu Client ditutup.");
    return true;
  }

  await runMenuHandler({
    handlers: clientRequestHandlers,
    menuName: "clientrequest",
    session,
    chatId,
    text,
    waClient,
    clientLabel,
    args: [
      pool,
      userModel,
      clientService,
      migrateUsersFromFolder,
      checkGoogleSheetCsvStatus,
      importUsersFromGoogleSheet,
      fetchAndStoreInstaContent,
      fetchAndStoreTiktokContent,
      formatClientData,
      handleFetchLikesInstagram,
      handleFetchKomentarTiktokBatch,
    ],
    invalidStepMessage:
      "⚠️ Sesi menu client tidak dikenali. Ketik *clientrequest* ulang atau *batal*.",
    failureMessage:
      "❌ Terjadi kesalahan pada menu client. Ketik *clientrequest* ulang untuk memulai kembali.",
  });

  return true;
}

export function createHandleMessage(waClient, options = {}) {
  const { allowUserMenu = true, clientLabel = "[WA]", markSeen = true } = options;

  return async function handleMessage(msg) {
    const chatId = msg.from;
    const text = (msg.body || "").trim();
    const userWaNum = chatId.replace(/[^0-9]/g, "");
    const initialIsMyContact =
      typeof msg.isMyContact === "boolean" ? msg.isMyContact : null;
    const isGroupChat = chatId?.endsWith("@g.us");
    const senderId = msg.author || chatId;
    const isAdmin = isAdminWhatsApp(senderId);
    const normalizedSenderAdminId =
      typeof senderId === "string"
        ? senderId.endsWith("@c.us")
          ? senderId
          : senderId.replace(/\D/g, "") + "@c.us"
        : "";
    const adminWaId = isAdmin
      ? getAdminWAIds().find((wid) => wid === normalizedSenderAdminId) || null
      : null;
    console.log(`${clientLabel} Incoming message from ${chatId}: ${text}`);
    if (msg.isStatus || chatId === "status@broadcast") {
      console.log(`${clientLabel} Ignored status message from ${chatId}`);
      return;
    }
    const waitForReady =
      typeof waClient.waitForWaReady === "function"
        ? waClient.waitForWaReady
        : () => waitForClientReady(waClient);
    const isReady = await waitForReady().then(
      () => true,
      () => false
    );
    if (!isReady) {
      console.warn(
        `${clientLabel} Client not ready, message from ${msg.from} deferred`
      );
      const readinessState = getClientReadinessState(waClient);
      readinessState.pendingMessages.push({ msg, allowReplay: true });
      waClient
        .sendMessage(msg.from, "🤖 Bot sedang memuat, silakan tunggu")
        .catch(() => {
          console.warn(
            `${clientLabel} Failed to notify ${msg.from} about loading state`
          );
        });
      return;
    }

    if (markSeen && typeof waClient.sendSeen === "function") {
      await sleep(1000);
      try {
        await waClient.sendSeen(chatId);
      } catch (err) {
        console.warn(
          `${clientLabel} Failed to mark ${chatId} as read: ${err?.message || err}`
        );
      }
    }

    // ===== Deklarasi State dan Konstanta =====
    let session = getSession(chatId);

    if (isGroupChat) {
      const handledGroupComplaint = await handleComplaintMessageIfApplicable({
        text,
        allowUserMenu,
        session,
        isAdmin,
        initialIsMyContact,
        senderId,
        chatId,
        adminOptionSessions,
        setSession,
        getSession,
        waClient,
        pool,
        userModel,
      });
      if (!handledGroupComplaint) {
        console.log(`${clientLabel} Ignored group message from ${chatId}`);
      }
      return;
    }

    const hasAnySession = () =>
      Boolean(getSession(chatId)) ||
      Boolean(userMenuContext[chatId]) ||
      Boolean(waBindSessions[chatId]) ||
      Boolean(updateUsernameSession[chatId]) ||
      Boolean(userRequestLinkSessions[chatId]) ||
      Boolean(operatorOptionSessions[chatId]) ||
      Boolean(adminOptionSessions[chatId]);
    const hadSessionAtStart = allowUserMenu ? hasAnySession() : false;
    let mutualReminderComputed = false;
    let mutualReminderResult = {
      shouldRemind: false,
      message: null,
      savedInDb: false,
      savedInWhatsapp: false,
      user: null,
    };
    // Save contact for non-group chats
    if (!chatId.endsWith("@g.us")) {
      await saveContactIfNew(chatId);
    }

    let cachedUserByWa = null;
    let userByWaError = null;
    let userByWaFetched = false;

    const getUserByWa = async () => {
      if (userByWaFetched) {
        return cachedUserByWa;
      }
      userByWaFetched = true;
      if (!userWaNum) return null;
      try {
        cachedUserByWa = await userModel.findUserByWhatsApp(userWaNum);
      } catch (err) {
        userByWaError = err;
        console.error(
          `${clientLabel} failed to load user by WhatsApp ${userWaNum}: ${err.message}`
        );
      }
      return cachedUserByWa;
    };

    const computeMutualReminder = async () => {
      if (!allowUserMenu) {
        mutualReminderComputed = true;
        return mutualReminderResult;
      }
      if (mutualReminderComputed) {
        return mutualReminderResult;
      }

      const result = {
        shouldRemind: false,
        message: null,
        savedInDb: false,
        savedInWhatsapp: false,
        user: null,
      };

      let savedInDb = false;
      if (userWaNum) {
        try {
          const lookup = await query(
            "SELECT 1 FROM saved_contact WHERE phone_number = $1 LIMIT 1",
            [userWaNum]
          );
          savedInDb = lookup.rowCount > 0;
        } catch (err) {
          console.error(
            `${clientLabel} failed to check saved_contact for ${chatId}: ${err.message}`
          );
        }
      }

      const user = await getUserByWa();
      result.user = user || null;

      if (user && !savedInDb) {
        try {
          await saveContactIfNew(chatId);
          savedInDb = true;
        } catch (err) {
          console.error(
            `${clientLabel} failed to persist contact for ${chatId}: ${err.message}`
          );
        }
      }

      let savedInWhatsapp =
        typeof initialIsMyContact === "boolean" ? initialIsMyContact : null;

      const refreshContactState = async () => {
        if (typeof waClient.getContact !== "function") {
          return savedInWhatsapp;
        }
        try {
          const contact = await waClient.getContact(chatId);
          return contact?.isMyContact ?? savedInWhatsapp;
        } catch (err) {
          console.warn(
            `${clientLabel} failed to refresh contact info for ${chatId}: ${err?.message || err}`
          );
          return savedInWhatsapp;
        }
      };

      if (savedInWhatsapp === null) {
        savedInWhatsapp = await refreshContactState();
      }

      if (user && savedInDb && savedInWhatsapp !== true) {
        savedInWhatsapp = await refreshContactState();
      }

      const isMutual = Boolean(savedInWhatsapp) && savedInDb;

      if (!isMutual) {
        result.shouldRemind = true;
        result.message =
          "📌 Mohon simpan nomor ini sebagai *WA Center CICERO* agar pemberitahuan dan layanan dapat diterima tanpa hambatan.";
      }

      result.savedInDb = savedInDb;
      result.savedInWhatsapp = Boolean(savedInWhatsapp);

      mutualReminderResult = result;
      mutualReminderComputed = true;
      return mutualReminderResult;
    };

    const processMessage = async () => {
      const lowerText = text.toLowerCase();
      const trimmedText = text.trim();
      const isAdminCommand = adminCommands.some((cmd) =>
        lowerText.startsWith(cmd)
      );
      const clearUserRequestLinkSession = (id = chatId) => {
        const sessionRef = userRequestLinkSessions[id];
        if (sessionRef?.timeout) {
          clearTimeout(sessionRef.timeout);
        }
        delete userRequestLinkSessions[id];
      };

      const startUserMenuSession = async () => {
        if (!allowUserMenu) {
          return false;
        }
        if (!userMenuContext[chatId]) {
          userMenuContext[chatId] = {};
      }
      try {
        await userMenuHandlers.main(
          userMenuContext[chatId],
          chatId,
          "",
          waClient,
          pool,
          userModel
        );
        const expectReply = shouldExpectQuickReply(userMenuContext[chatId]);
        setMenuTimeout(chatId, waClient, expectReply);
        return true;
      } catch (err) {
        console.error(`${clientLabel} user menu start error: ${err.message}`);
        await safeSendMessage(
          waClient,
          chatId,
          "❌ Gagal memulai menu pengguna. Silakan coba lagi nanti."
        );
        return true;
      }
    };

      const handleProfileLinkForUserRequest = async () => {
        if (!allowUserMenu) return false;
        const extracted = extractProfileUsername(text);
        if (!extracted) return false;

        if (userByWaError) {
        await waClient.sendMessage(
          chatId,
          "❌ Sistem gagal memeriksa data WhatsApp Anda. Silakan coba kembali nanti."
        );
        return true;
      }

      const user = await getUserByWa();
      if (!user) {
        const started = await startUserMenuSession();
        if (!started) {
          await waClient.sendMessage(
            chatId,
            "Nomor WhatsApp Anda belum terdaftar. Silakan kirimkan NRP Anda untuk melanjutkan."
          );
        }
        return true;
      }

      const field = extracted.platform === "instagram" ? "insta" : "tiktok";
      const storedRaw = user[field];
      const storedNormalized =
        extracted.platform === "instagram"
          ? normalizeInstagramUsername(storedRaw)
          : normalizeTiktokUsername(storedRaw);
      const storedDisplay = storedNormalized
        ? formatSocialUsername(extracted.platform, storedNormalized)
        : null;

      if (storedNormalized && storedNormalized === extracted.normalized) {
        const verification = await verifySocialAccount(
          extracted.platform,
          extracted.normalized
        );
        if (verification.error) {
          await waClient.sendMessage(
            chatId,
            `⚠️ Gagal memeriksa akun ${getPlatformLabel(
              extracted.platform
            )} ${extracted.display}: ${
              verification.error?.message || String(verification.error)
            }`
          );
          return true;
        }
        if (verification.active) {
          await waClient.sendMessage(
            chatId,
            [
              `✅ Akun ${getPlatformLabel(extracted.platform)} ${extracted.display} aktif dan terbaca sistem.`,
              `Postingan: ${formatCount(verification.postCount)}`,
              `Follower: ${formatCount(verification.followerCount)}`,
              `Following: ${formatCount(verification.followingCount)}`,
            ].join("\n")
          );
        } else {
          await waClient.sendMessage(
            chatId,
            `⚠️ Akun ${getPlatformLabel(
              extracted.platform
            )} ${extracted.display} belum terbaca aktif oleh sistem. Pastikan akun tidak private dan memiliki konten.`
          );
        }
        return true;
      }

      const linkVerification = await verifySocialAccount(
        extracted.platform,
        extracted.normalized
      );
      let storedVerification = null;
      if (storedNormalized) {
        storedVerification =
          storedNormalized === extracted.normalized
            ? linkVerification
            : await verifySocialAccount(extracted.platform, storedNormalized);
      }

      if (linkVerification.error && (!storedVerification || storedVerification.error)) {
        const errMsg = linkVerification.error || storedVerification?.error;
        await waClient.sendMessage(
          chatId,
          `⚠️ Gagal memeriksa akun ${getPlatformLabel(
            extracted.platform
          )}: ${errMsg?.message || String(errMsg)}`
        );
        return true;
      }

      const linkActive = linkVerification.active;
      const storedActive = storedVerification?.active || false;
      const lines = [
        `Perbandingan akun ${getPlatformLabel(extracted.platform)}:`,
        formatVerificationSummary(
          "Data sistem",
          extracted.platform,
          storedDisplay,
          storedVerification
        ),
        formatVerificationSummary(
          "Link Anda",
          extracted.platform,
          extracted.display,
          linkVerification
        ),
      ];

      if (storedActive && linkActive && storedNormalized) {
        lines.push(
          "",
          `Keduanya aktif. Balas *1* untuk mempertahankan ${storedDisplay} atau *2* untuk mengganti ke ${extracted.display}.`,
          "Balas *batal* untuk membatalkan pilihan."
        );
        userRequestLinkSessions[chatId] = {
          platform: extracted.platform,
          field,
          userId: user.user_id,
          newValue: extracted.storeValue,
          newDisplay: extracted.display,
          previousDisplay: storedDisplay,
        };
        setUserRequestLinkTimeout(chatId);
        await waClient.sendMessage(chatId, lines.join("\n"));
        return true;
      }

      if (storedActive || linkActive) {
        lines.push(
          "",
          storedActive
            ? `✅ Akun ${getPlatformLabel(extracted.platform)} ${storedDisplay} di database adalah akun aktif dan terbaca sistem.`
            : `✅ Akun ${getPlatformLabel(extracted.platform)} ${extracted.display} dari link Anda aktif dan terbaca sistem.`
        );
        await waClient.sendMessage(chatId, lines.join("\n"));
        return true;
      }

      lines.push(
        "",
        `⚠️ Belum ada akun ${getPlatformLabel(
          extracted.platform
        )} yang terbaca aktif. Pastikan akun tidak private dan memiliki konten.`
      );
      await waClient.sendMessage(chatId, lines.join("\n"));
      return true;
    };

    if (
      trimmedText &&
      BULK_STATUS_HEADER_REGEX.test(trimmedText) &&
      (!session || session.menu === "clientrequest")
    ) {
      const nextSession = {
        ...(session || {}),
        menu: "clientrequest",
        step: "bulkStatus_process",
      };
      setSession(chatId, nextSession);
      session = getSession(chatId);
      await runMenuHandler({
        handlers: clientRequestHandlers,
        menuName: "clientrequest",
        session,
        chatId,
        text: trimmedText,
        waClient,
        clientLabel,
        args: [
          pool,
          userModel,
          clientService,
          migrateUsersFromFolder,
          checkGoogleSheetCsvStatus,
          importUsersFromGoogleSheet,
          fetchAndStoreInstaContent,
          fetchAndStoreTiktokContent,
          formatClientData,
          handleFetchLikesInstagram,
          handleFetchKomentarTiktokBatch,
        ],
        invalidStepMessage:
          "⚠️ Sesi menu client tidak dikenali. Ketik *clientrequest* ulang atau *batal*.",
        failureMessage:
          "❌ Terjadi kesalahan pada menu client. Ketik *clientrequest* ulang untuk memulai kembali.",
      });
      return;
    }

    if (allowUserMenu && userRequestLinkSessions[chatId]) {
      const selection = userRequestLinkSessions[chatId];
      if (lowerText === "batal") {
        await waClient.sendMessage(
          chatId,
          "Perubahan dibatalkan. Username tetap menggunakan data sebelumnya."
        );
        clearUserRequestLinkSession();
        return;
      }
      if (lowerText === "1") {
        await waClient.sendMessage(
          chatId,
          selection.previousDisplay
            ? `Data username tetap menggunakan ${selection.previousDisplay}.`
            : "Belum ada perubahan username yang disimpan."
        );
        clearUserRequestLinkSession();
        return;
      }
      if (lowerText === "2") {
        try {
          await userModel.updateUserField(
            selection.userId,
            selection.field,
            selection.newValue
          );
          await waClient.sendMessage(
            chatId,
            `✅ Username ${getPlatformLabel(selection.platform)} berhasil diupdate menjadi ${selection.newDisplay}.`
          );
        } catch (err) {
          await waClient.sendMessage(
            chatId,
            `❌ Gagal menyimpan perubahan username: ${err.message}`
          );
        }
        clearUserRequestLinkSession();
        return;
      }
      await waClient.sendMessage(
        chatId,
        "Balas *1* untuk mempertahankan data lama, *2* untuk mengganti ke username baru, atau *batal* untuk membatalkan."
      );
      setUserRequestLinkTimeout(chatId);
      return;
    }

    // =========== Menu User Interaktif ===========
    if (userMenuContext[chatId] && lowerText === "batal") {
      const session = userMenuContext[chatId];
      // Clear all timeouts
      if (session.timeout) clearTimeout(session.timeout);
      if (session.warningTimeout) clearTimeout(session.warningTimeout);
      if (session.noReplyTimeout) clearTimeout(session.noReplyTimeout);
      delete userMenuContext[chatId];
      if (allowUserMenu) {
        await waClient.sendMessage(chatId, "✅ Menu User ditutup. Terima kasih.");
      }
      return;
    }
    if (session && lowerText === "batal") {
      const menuLabels = {
        oprrequest: "Menu Operator",
        dirrequest: "Menu Direktorat",
        clientrequest: "Menu Client",
        wabotditbinmas: "Menu Wabot Ditbinmas",
      };
      clearSession(chatId);
      const label = menuLabels[session.menu] || "Menu";
      await waClient.sendMessage(chatId, `✅ ${label} ditutup.`);
      return;
    }

    // ===== Pilihan awal untuk nomor operator =====
    if (operatorOptionSessions[chatId]) {
      if (/^1$/.test(text.trim())) {
        delete operatorOptionSessions[chatId];
        setSession(chatId, { menu: "oprrequest", step: "main" });
        await runMenuHandler({
          handlers: oprRequestHandlers,
          menuName: "oprrequest",
          session: getSession(chatId),
          chatId,
          text: `┏━━━ *MENU OPERATOR CICERO* ━━━┓\n👮‍♂️  Akses khusus operator client.\n\n1️⃣ Manajemen User\n2️⃣ Manajemen Amplifikasi\n\nKetik *angka menu* di atas, atau *batal* untuk keluar.\n┗━━━━━━━━━━━━━━━━━━━━━━━━┛`,
          waClient,
          clientLabel,
          args: [pool, userModel],
          invalidStepMessage:
            "⚠️ Sesi menu operator tidak dikenali. Ketik *oprrequest* ulang atau *batal*.",
          failureMessage:
            "❌ Terjadi kesalahan pada menu operator. Ketik *oprrequest* ulang untuk memulai kembali.",
        });
        return;
      }
      if (/^2$/.test(text.trim())) {
        delete operatorOptionSessions[chatId];
        if (!allowUserMenu) {
          return;
        }
        const pengirim = chatId.replace(/[^0-9]/g, "");
        const userByWA = await userModel.findUserByWhatsApp(pengirim);
        const salam = getGreeting();
        if (userByWA) {
          userMenuContext[chatId] = {
            step: "confirmUserByWaUpdate",
            user_id: userByWA.user_id,
          };
          const msg = `${salam}, Bapak/Ibu\n${formatUserSummary(userByWA)}\n\nApakah Anda ingin melakukan perubahan data?\nBalas *ya* untuk memulai update atau *tidak* untuk melewati.`;
          await waClient.sendMessage(chatId, msg.trim());
          setMenuTimeout(
            chatId,
            waClient,
            shouldExpectQuickReply(userMenuContext[chatId])
          );
        } else {
          userMenuContext[chatId] = { step: "inputUserId" };
          const msg =
            `${salam}! Nomor WhatsApp Anda belum terdaftar.` +
            "\n\nBalas pesan ini dengan memasukan NRP Anda," +
            "\n\n*Contoh Pesan Balasan : 87020990*";
          await waClient.sendMessage(chatId, msg.trim());
          setMenuTimeout(
            chatId,
            waClient,
            shouldExpectQuickReply(userMenuContext[chatId])
          );
        }
        return;
      }
      await waClient.sendMessage(
        chatId,
        "Balas *1* untuk Menu Operator atau *2* untuk perubahan data username."
      );
      setOperatorOptionTimeout(chatId);
      return;
    }

    // ===== Pilihan awal untuk nomor admin =====
    if (adminOptionSessions[chatId]) {
      if (/^1$/.test(text.trim())) {
        delete adminOptionSessions[chatId];
        setSession(chatId, { menu: "clientrequest", step: "main" });
        await waClient.sendMessage(
          chatId,
          `┏━━━ *MENU CLIENT CICERO* ━━━\n1️⃣ Manajemen Client & User\n2️⃣ Operasional Media Sosial\n3️⃣ Transfer & Laporan\n4️⃣ Administratif\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━\nKetik *angka* menu, atau *batal* untuk keluar.`
        );
        return;
      }
      if (/^2$/.test(text.trim())) {
        delete adminOptionSessions[chatId];
        const started = await startAdminOprRequestSelection({
          chatId,
          waClient,
          clientLabel,
        });
        if (!started) {
          return;
        }
        return;
      }
      if (/^3$/.test(text.trim())) {
        delete adminOptionSessions[chatId];
        if (!allowUserMenu) {
          return;
        }
        const pengirim = chatId.replace(/[^0-9]/g, "");
        const userByWA = await userModel.findUserByWhatsApp(pengirim);
        const salam = getGreeting();
        if (userByWA) {
          userMenuContext[chatId] = {
            step: "confirmUserByWaUpdate",
            user_id: userByWA.user_id,
          };
          const msg = `${salam}, Bapak/Ibu\n${formatUserSummary(userByWA)}\n\nApakah Anda ingin melakukan perubahan data?\nBalas *ya* untuk memulai update atau *tidak* untuk melewati.`;
          await waClient.sendMessage(chatId, msg.trim());
          setMenuTimeout(
            chatId,
            waClient,
            shouldExpectQuickReply(userMenuContext[chatId])
          );
        } else {
          userMenuContext[chatId] = { step: "inputUserId" };
          const msg =
            `${salam}! Nomor WhatsApp Anda belum terdaftar.` +
            "\n\nBalas pesan ini dengan memasukan NRP Anda," +
            "\n\n*Contoh Pesan Balasan : 87020990*";
          await waClient.sendMessage(chatId, msg.trim());
          setMenuTimeout(
            chatId,
            waClient,
            shouldExpectQuickReply(userMenuContext[chatId])
          );
        }
        return;
      }
      await waClient.sendMessage(
        chatId,
        "Balas *1* untuk Menu Client, *2* untuk Menu Operator, atau *3* untuk perubahan data user."
      );
      setAdminOptionTimeout(chatId);
      return;
    }

  // ===== Handler Menu Operator =====
  if (session && session.menu === "oprrequest") {
    // Routing pesan sesuai langkah/session operator (tambah user, update status, dst)
    await runMenuHandler({
      handlers: oprRequestHandlers,
      menuName: "oprrequest",
      session,
      chatId,
      text,
      waClient,
      clientLabel,
      args: [pool, userModel],
      invalidStepMessage:
        "⚠️ Sesi menu operator tidak dikenali. Ketik *oprrequest* ulang atau *batal*.",
      failureMessage:
        "❌ Terjadi kesalahan pada menu operator. Ketik *oprrequest* ulang untuk memulai kembali.",
    });
    return;
  }

  if (session && session.menu === "dirrequest") {
    await runMenuHandler({
      handlers: dirRequestHandlers,
      menuName: "dirrequest",
      session,
      chatId,
      text,
      waClient,
      clientLabel,
      invalidStepMessage:
        "⚠️ Sesi menu dirrequest tidak dikenali. Ketik *dirrequest* ulang atau *batal*.",
      failureMessage:
        "❌ Terjadi kesalahan pada menu dirrequest. Ketik *dirrequest* ulang untuk memulai kembali.",
    });
    return;
  }

  if (session && session.menu === "wabotditbinmas") {
    await wabotDitbinmasHandlers[session.step || "main"](
      session,
      chatId,
      text,
      waClient
    );
    return;
  }

  // ===== MULAI Menu Operator dari command manual =====
  if (text.toLowerCase() === "oprrequest") {
    if (isAdminWhatsApp(chatId)) {
      await startAdminOprRequestSelection({
        chatId,
        waClient,
        clientLabel,
      });
      return;
    }
    
    const waId =
      userWaNum.startsWith("62") ? userWaNum : "62" + userWaNum.replace(/^0/, "");
    const operator = await findByOperator(waId);
    const superAdmin = operator ? null : await findBySuperAdmin(waId);
    
    // Check if user has same client_id as any admin (LID check)
    const hasSameLidAsAdmin = !operator && !superAdmin 
      ? await hasSameClientIdAsAdmin(waId, pool.query)
      : false;
    
    if (!operator && !superAdmin && !hasSameLidAsAdmin) {
      // User not found in client table - offer linking options
      const orgClients = await clientService.findAllClientsByType("org");
      const availableClients = (orgClients || [])
        .filter((client) => client?.client_id && client?.client_status)
        .map((client) => ({
          client_id: String(client.client_id).toUpperCase(),
          nama: client.nama || client.client_id,
        }));
      
      if (availableClients.length === 0) {
        await waClient.sendMessage(
          chatId,
          "❌ Tidak ada client bertipe ORG yang aktif untuk menu operator."
        );
        return;
      }
      
      // Start account linking flow
      setSession(chatId, {
        menu: "oprrequest",
        step: "link_choose_role",
        opr_clients: availableClients,
        linking_wa_id: waId,
      });
      
      const msg = `🔗 *Penautan Akun Operator/Super Admin*

Nomor Anda belum terdaftar di sistem. Silakan pilih peran yang ingin Anda tautkan:

1️⃣ Operator
2️⃣ Super Admin

Ketik *angka* untuk memilih, atau *batal* untuk keluar.`;
      
      await waClient.sendMessage(chatId, msg);
      return;
    }
    
    // If user has same LID as admin, show ORG client selection
    if (hasSameLidAsAdmin && !operator && !superAdmin) {
      const orgClients = await clientService.findAllClientsByType("org");
      const availableClients = (orgClients || [])
        .filter((client) => client?.client_id && client?.client_status)
        .map((client) => ({
          client_id: String(client.client_id).toUpperCase(),
          nama: client.nama || client.client_id,
        }));
      
      if (availableClients.length === 0) {
        await waClient.sendMessage(
          chatId,
          "❌ Tidak ada client bertipe ORG yang aktif untuk menu operator."
        );
        return;
      }
      
      setSession(chatId, {
        menu: "oprrequest",
        step: "choose_client",
        opr_clients: availableClients,
      });
      
      await runMenuHandler({
        handlers: oprRequestHandlers,
        menuName: "oprrequest",
        session: getSession(chatId),
        chatId,
        text: "",
        waClient,
        clientLabel,
        args: [pool, userModel],
        invalidStepMessage:
          "⚠️ Sesi menu operator tidak dikenali. Ketik *oprrequest* ulang atau *batal*.",
        failureMessage:
          "❌ Terjadi kesalahan pada menu operator. Ketik *oprrequest* ulang untuk memulai kembali.",
      });
      return;
    }
    
    setSession(chatId, {
      menu: "oprrequest",
      step: "main",
      selected_client_id: superAdmin?.client_id || undefined,
    });
    await runMenuHandler({
      handlers: oprRequestHandlers,
      menuName: "oprrequest",
      session: getSession(chatId),
      chatId,
    text: `┏━━━ *MENU OPERATOR CICERO* ━━━┓
👮‍♂️  Akses khusus operator client.

1️⃣ Manajemen User
2️⃣ Manajemen Amplifikasi
3️⃣ Manajemen Engagement

Ketik *angka menu* di atas, atau *batal* untuk keluar.
┗━━━━━━━━━━━━━━━━━━━━━━━━━┛`,
      waClient,
      clientLabel,
      args: [pool, userModel],
      invalidStepMessage:
        "⚠️ Sesi menu operator tidak dikenali. Ketik *oprrequest* ulang atau *batal*.",
      failureMessage:
        "❌ Terjadi kesalahan pada menu operator. Ketik *oprrequest* ulang untuk memulai kembali.",
    });
    return;
  }

  if (text.toLowerCase() === "dirrequest") {
    // Allow access from all WhatsApp numbers
    const directorateClients =
      await clientService.findAllActiveDirektoratClients();
    const activeDirectorateClients = (directorateClients || []).map((client) => ({
      client_id: (client.client_id || "").toUpperCase(),
      nama: client.nama || client.client_id || "",
    }));

    if (!activeDirectorateClients.length) {
      await waClient.sendMessage(
        chatId,
        "❌ Tidak ada client Direktorat aktif yang dapat dipilih saat ini."
      );
      return;
    }

    setSession(chatId, {
      menu: "dirrequest",
      step: "choose_client",
      dir_clients: activeDirectorateClients,
    });
    await runMenuHandler({
      handlers: dirRequestHandlers,
      menuName: "dirrequest",
      session: getSession(chatId),
      chatId,
      text: "",
      waClient,
      clientLabel,
      invalidStepMessage:
        "⚠️ Sesi menu dirrequest tidak dikenali. Ketik *dirrequest* ulang atau *batal*.",
      failureMessage:
        "❌ Terjadi kesalahan pada menu dirrequest. Ketik *dirrequest* ulang untuk memulai kembali.",
    });
    return;
  }

  const normalizedWabotCmd = text.toLowerCase().replace(/\s+/g, "");
  if (
    normalizedWabotCmd === "wabot" ||
    normalizedWabotCmd === "wabotditbinmas" ||
    normalizedWabotCmd === "ditbinmas"
  ) {
    // Check if user is admin
    if (!senderId || !isAdminWhatsApp(senderId)) {
      await waClient.sendMessage(
        chatId,
        "❌ Fitur ini hanya tersedia untuk administrator."
      );
      return;
    }

    setSession(chatId, {
      menu: "wabotditbinmas",
      step: "main",
      time: Date.now(),
    });
    await wabotDitbinmasHandlers.main(getSession(chatId), chatId, "", waClient);
    return;
  }

  const handledComplaint = await handleComplaintMessageIfApplicable({
    text,
    allowUserMenu,
    session,
    isAdmin,
    initialIsMyContact,
    senderId,
    chatId,
    adminOptionSessions,
    setSession,
    getSession,
    waClient,
    pool,
    userModel,
  });
  if (handledComplaint) {
    return;
  }

  const handledClientRequestSession = await handleClientRequestSessionStep({
    session,
    chatId,
    text,
    waClient,
    clientLabel,
    pool,
    userModel,
    clientService,
    migrateUsersFromFolder,
    checkGoogleSheetCsvStatus,
    importUsersFromGoogleSheet,
    fetchAndStoreInstaContent,
    fetchAndStoreTiktokContent,
    formatClientData,
    handleFetchLikesInstagram,
    handleFetchKomentarTiktokBatch,
  });
  if (handledClientRequestSession) return;


    // ===== Handler Menu User Interaktif Step Lanjut =====
    if (userMenuContext[chatId]) {
      if (!allowUserMenu) {
        delete userMenuContext[chatId];
        return;
      }
      setMenuTimeout(chatId, waClient);
      const session = userMenuContext[chatId];
      const handler = userMenuHandlers[session.step];
      if (handler) {
        await handler(session, chatId, text, waClient, pool, userModel);
        if (session.exit) {
          clearTimeout(session.timeout);
          clearTimeout(session.warningTimeout);
          clearTimeout(session.noReplyTimeout);
          delete userMenuContext[chatId];
        } else {
          const expectReply = shouldExpectQuickReply(session);
          setMenuTimeout(chatId, waClient, expectReply);
        }
      } else {
        await waClient.sendMessage(
          chatId,
          "⚠️ Sesi menu user tidak dikenal, silakan ketik *userrequest* ulang atau *batal*."
        );
        clearTimeout(session.timeout);
        clearTimeout(session.warningTimeout);
        clearTimeout(session.noReplyTimeout);
        delete userMenuContext[chatId];
      }
      return;
    }

    // ========== Mulai Menu Interaktif User ==========
    if (lowerText === "userrequest") {
      if (!allowUserMenu) {
        return;
      }
      await startUserMenuSession();
      return;
    }

    if (allowUserMenu && !userMenuContext[chatId]) {
      const started = await startUserMenuSession();
      if (started) {
        return;
      }
    }

  // ===== Handler Menu Client =====
  if (text.toLowerCase() === "clientrequest") {
    setSession(chatId, { menu: "clientrequest", step: "main" });
    await runMenuHandler({
      handlers: clientRequestHandlers,
      menuName: "clientrequest",
      session: getSession(chatId),
      chatId,
      text: "",
      waClient,
      clientLabel,
      args: [
        pool,
        userModel,
        clientService,
        migrateUsersFromFolder,
        checkGoogleSheetCsvStatus,
        importUsersFromGoogleSheet,
        fetchAndStoreInstaContent,
        fetchAndStoreTiktokContent,
        formatClientData,
        handleFetchLikesInstagram,
        handleFetchKomentarTiktokBatch,
      ],
      invalidStepMessage:
        "⚠️ Sesi menu client tidak dikenali. Ketik *clientrequest* ulang atau *batal*.",
      failureMessage:
        "❌ Terjadi kesalahan pada menu client. Ketik *clientrequest* ulang untuk memulai kembali.",
    });
    return;
  }


  // ========== VALIDASI ADMIN COMMAND ==========
  if (
    isAdminCommand &&
    !isAdmin &&
    !text.toLowerCase().startsWith("thisgroup#")
  ) {
    await waClient.sendMessage(
      chatId,
      "❌ Anda tidak memiliki akses ke sistem ini."
    );
    return;
  }

  if (text.toLowerCase() === "savecontact") {
    try {
      const auth = await authorize();
      const users = await userModel.getActiveUsersWithWhatsapp();
      let saved = 0;
      for (const u of users) {
        const exists = await searchByNumbers(auth, [u.whatsapp]);
        if (!exists[u.whatsapp]) {
          await saveGoogleContact(auth, { name: u.nama, phone: u.whatsapp });
          saved++;
        }
      }
      await waClient.sendMessage(
        chatId,
        `✅ Kontak tersimpan ke Google: ${saved}`
      );
    } catch (err) {
      await waClient.sendMessage(
        chatId,
        `❌ Gagal menyimpan kontak: ${err.message}`
      );
    }
    return;
  }

  if (text.toLowerCase().startsWith("notifwa#")) {
    const [, prefRaw] = text.split("#");
    const normalized = String(prefRaw || "").trim().toLowerCase();
    let optIn;
    if (["on", "ya", "yes", "true", "1", "aktif"].includes(normalized)) {
      optIn = true;
    } else if (
      ["off", "no", "tidak", "false", "0", "nonaktif"].includes(normalized)
    ) {
      optIn = false;
    }

    if (typeof optIn !== "boolean") {
      await waClient.sendMessage(
        chatId,
        "Format salah! Gunakan notifwa#on atau notifwa#off untuk mengatur preferensi notifikasi."
      );
      return;
    }

    const waNum = chatId.replace(/[^0-9]/g, "");
    const user = await userModel.findUserByWhatsApp(waNum);
    if (!user) {
      await waClient.sendMessage(
        chatId,
        "Nomor WhatsApp ini belum terhubung ke data user. Mohon selesaikan binding akun terlebih dahulu dengan mengirimkan NRP/NIP sesuai petunjuk."
      );
      return;
    }

    await userModel.updateUserField(
      user.user_id,
      "wa_notification_opt_in",
      optIn
    );
    await waClient.sendMessage(
      chatId,
      optIn
        ? "✅ Notifikasi WhatsApp untuk likes/komentar Instagram diaktifkan."
        : "🚫 Notifikasi WhatsApp untuk likes/komentar Instagram dimatikan."
    );
    return;
  }

  // ========== Update Username via Link Profile IG/TikTok ==========
  if (
    !text.includes("#") &&
    (IG_PROFILE_REGEX.test(text.trim()) || TT_PROFILE_REGEX.test(text.trim()))
  ) {
    if (await handleProfileLinkForUserRequest()) {
      return;
    }
    updateUsernameSession[chatId] = {
      link: text.trim(),
      step: "confirm",
    };
    await waClient.sendMessage(
      chatId,
      `Apakah Anda ingin mengupdate username akun Anda sesuai link ini?\n*${text.trim()}*\n\nBalas *ya* untuk melanjutkan atau *tidak* untuk membatalkan.`
    );
    return;
  }

  // ========== Proses Konfirmasi Update Username ==========
  if (
    updateUsernameSession[chatId] &&
    updateUsernameSession[chatId].step === "confirm"
  ) {
    const jawaban = text.trim().toLowerCase();
    if (["tidak", "batal", "no", "cancel"].includes(jawaban)) {
      delete updateUsernameSession[chatId];
      await waClient.sendMessage(chatId, "Update username dibatalkan.");
      return;
    }
    if (jawaban !== "ya") {
      await waClient.sendMessage(
        chatId,
        "Balas *ya* untuk melanjutkan update username atau *tidak* untuk membatalkan."
      );
      return;
    }
    // Ekstrak username
    let username = null;
    let field = null;
    let match = null;
    if ((match = updateUsernameSession[chatId].link.match(IG_PROFILE_REGEX))) {
      username = match[2].toLowerCase();
      field = "insta";
    } else if (
      (match = updateUsernameSession[chatId].link.match(TT_PROFILE_REGEX))
    ) {
      username = "@" + match[2].replace(/^@+/, "").toLowerCase();
      field = "tiktok";
    }
    if (!username || !field) {
      await waClient.sendMessage(
        chatId,
        "Link tidak valid atau sistem gagal membaca username."
      );
      delete updateUsernameSession[chatId];
      return;
    }
    let waNum = chatId.replace(/[^0-9]/g, "");
    let user = await userModel.findUserByWhatsApp(waNum);
    if (user) {
      await userModel.updateUserField(user.user_id, field, username);
      await waClient.sendMessage(
        chatId,
        `✅ Username *${
          field === "insta" ? "Instagram" : "TikTok"
        }* berhasil diupdate menjadi *${username}* untuk user NRP/NIP *${
          user.user_id
        }*.`
      );
      delete updateUsernameSession[chatId];
      return;
    } else {
      updateUsernameSession[chatId].step = "ask_nrp";
      updateUsernameSession[chatId].username = username;
      updateUsernameSession[chatId].field = field;
      await waClient.sendMessage(
        chatId,
        "Nomor WhatsApp Anda belum terhubung ke data user mana pun.\nSilakan masukkan NRP Anda untuk melakukan binding akun atau balas *batal* untuk keluar:"
      );
      return;
    }
  }

  // ========== Proses Binding NRP/NIP ==========
  if (
    updateUsernameSession[chatId] &&
    updateUsernameSession[chatId].step === "ask_nrp"
  ) {
    const nrp = text.replace(/[^0-9a-zA-Z]/g, "");
    if (!nrp) {
      await waClient.sendMessage(
        chatId,
        "NRP yang Anda masukkan tidak valid. Coba lagi atau balas *batal* untuk membatalkan."
      );
      return;
    }
    const user = await userModel.findUserById(nrp);
    if (!user) {
      await waClient.sendMessage(
        chatId,
        `❌ NRP *${nrp}* tidak ditemukan. Jika yakin benar, hubungi Opr Humas Polres Anda.`
      );
      return;
    }
    let waNum = chatId.replace(/[^0-9]/g, "");
    let waUsed = await userModel.findUserByWhatsApp(waNum);
    if (waUsed && waUsed.user_id !== user.user_id) {
      await waClient.sendMessage(
        chatId,
        `Nomor WhatsApp ini sudah terpakai pada NRP/NIP *${waUsed.user_id}*. Hanya satu user per WA yang diizinkan.`
      );
      delete updateUsernameSession[chatId];
      return;
    }
    await userModel.updateUserField(
      user.user_id,
      updateUsernameSession[chatId].field,
      updateUsernameSession[chatId].username
    );
    await userModel.updateUserField(user.user_id, "whatsapp", waNum);
    await waClient.sendMessage(
      chatId,
      `✅ Username *${
        updateUsernameSession[chatId].field === "insta" ? "Instagram" : "TikTok"
      }* berhasil diupdate menjadi *${
        updateUsernameSession[chatId].username
      }* dan nomor WhatsApp Anda telah di-bind ke user NRP/NIP *${
        user.user_id
      }*.`
    );
    delete updateUsernameSession[chatId];
    return;
  }

  // =========================
  // === FETCH INSTAGRAM (ADMIN)
  // =========================
  if (text.toLowerCase().startsWith("fetchinsta#")) {
    // format: fetchinsta#clientid#[key1,key2,...]
    const [, client_id_raw, keys_raw] = text.split("#");
    const client_id = (client_id_raw || "").trim().toUpperCase();

    // Default key list (optional, bisa modifikasi)
    const defaultKeys = ["shortcode", "caption", "like_count", "timestamp"];

    // Keys: array, jika ada, pisahkan koma
    let keys = defaultKeys;
    if (keys_raw && keys_raw.trim()) {
      keys = keys_raw.split(",").map((k) => k.trim());
    }

    if (!client_id) {
      await waClient.sendMessage(
        chatId,
        "Format salah!\nfetchinsta#clientid#[key1,key2,...]\nContoh: fetchinsta#JAKARTA#shortcode,caption"
      );
      return;
    }

    try {
      await fetchAndStoreInstaContent(keys, waClient, chatId, client_id); // pass client_id!
      await waClient.sendMessage(
        chatId,
        `✅ Selesai fetch Instagram untuk ${client_id}.`
      );
    } catch (err) {
      await waClient.sendMessage(
        chatId,
        `❌ Gagal fetch/simpan IG: ${err.message}`
      );
    }
    return;
  }

  // =========================
  // === FETCH TIKTOK MANUAL (ADMIN)
  // =========================
  if (text.toLowerCase().startsWith("fetchtiktok#")) {
    // Format: fetchtiktok#CLIENTID
    const [, client_id_raw] = text.split("#");
    const client_id = (client_id_raw || "").trim().toUpperCase();

    if (!client_id) {
      await waClient.sendMessage(
        chatId,
        "Format salah!\nGunakan: fetchtiktok#clientid"
      );
      return;
    }

    await waClient.sendMessage(
      chatId,
      `⏳ Memulai fetch TikTok untuk *${client_id}* ...`
    );

    try {
      // Pastikan fetchAndStoreTiktokContent menerima client_id sebagai param pertama!
      const { fetchAndStoreTiktokContent } = await import(
        "../service/tiktokFetchService.js"
      );
      const posts = await fetchAndStoreTiktokContent(
        client_id,
        waClient,
        chatId
      );

      if (!posts || posts.length === 0) {
        // fallback: dari DB
        const { getPostsTodayByClient } = await import(
          "../model/tiktokPostModel.js"
        );
        const postsDB = await getPostsTodayByClient(client_id);
        if (!postsDB || postsDB.length === 0) {
          await waClient.sendMessage(
            chatId,
            `❌ Tidak ada post TikTok hari ini untuk client *${client_id}*`
          );
          return;
        } else {
          await waClient.sendMessage(
            chatId,
            `⚠️ Tidak ada post baru dari API, menggunakan data dari database...`
          );
          // lanjut rekap dari DB (lihat di bawah)
          // NOTE: postsDB yang dipakai, bukan posts!
          // kode rekap di bawah
          postsDB.forEach((item, i) => {
            // isi seperti di bawah
          });
        }
      }

      // Ambil username TikTok client (untuk format link)
      let username = "-";
      try {
        const { findById } = await import("../model/clientModel.js");
        const client = await findById(client_id);
        username = client?.client_tiktok || "-";
        if (username.startsWith("@")) username = username.slice(1);
      } catch (userErr) {
        // skip
      }

      // Rekap dan kirim pesan
      let rekap = `*Rekap Post TikTok Hari Ini*\nClient: *${client_id}*\n\n`;
      const postsList = posts && posts.length > 0 ? posts : postsDB;
      rekap += `Jumlah post: *${postsList.length}*\n\n`;
      postsList.forEach((item, i) => {
        const desc = item.desc || item.caption || "-";
        let create_time =
          item.create_time || item.created_at || item.createTime;
        let created = "-";
        if (typeof create_time === "number") {
          if (create_time > 2000000000) {
            created = new Date(create_time).toLocaleString("id-ID", {
              timeZone: "Asia/Jakarta",
            });
          } else {
            created = new Date(create_time * 1000).toLocaleString("id-ID", {
              timeZone: "Asia/Jakarta",
            });
          }
        } else if (typeof create_time === "string") {
          created = new Date(create_time).toLocaleString("id-ID", {
            timeZone: "Asia/Jakarta",
          });
        } else if (create_time instanceof Date) {
          created = create_time.toLocaleString("id-ID", {
            timeZone: "Asia/Jakarta",
          });
        }
        const video_id = item.video_id || item.id;
        rekap += `#${i + 1} Video ID: ${video_id}\n`;
        rekap += `   Deskripsi: ${desc.slice(0, 50)}\n`;
        rekap += `   Tanggal: ${created}\n`;
        rekap += `   Like: ${
          item.digg_count ?? item.like_count ?? 0
        } | Komentar: ${item.comment_count ?? 0}\n`;
        rekap += `   Link: https://www.tiktok.com/@${username}/video/${video_id}\n\n`;
      });

      await waClient.sendMessage(chatId, rekap.trim());
    } catch (err) {
      await waClient.sendMessage(chatId, `❌ ERROR: ${err.message}`);
    }
    return;
  }

  // =========================
  // === FETCH LIKES INSTAGRAM (ADMIN)
  // =========================
  if (text.toLowerCase().startsWith("fetchlikes#")) {
    // Format: fetchlikes#clientid
    const [, client_id_raw] = text.split("#");
    const client_id = (client_id_raw || "").trim().toUpperCase();

    if (!client_id) {
      await waClient.sendMessage(
        chatId,
        "Format salah!\nGunakan: fetchlikes#clientid\nContoh: fetchlikes#POLRESABC"
      );
      return;
    }

    await waClient.sendMessage(
      chatId,
      "⏳ Mengambil & memperbarui data likes IG..."
    );

    // Update likes IG dulu (opsional, kalau handler-mu sudah update DB dari API, bisa skip try/catch ini)
    try {
      await handleFetchLikesInstagram(client_id, null, waClient, chatId);
      // handler ini update DB, lanjut rekap dari DB saja
    } catch (e) {
      await waClient.sendMessage(
        chatId,
        `⚠️ Gagal update likes IG dari API: ${e.message}\nAkan menampilkan data dari database terakhir.`
      );
    }

    // Ambil user & list shortcode (konten IG hari ini) dari database
    const users = await getUsersByClient(client_id);
    const shortcodes = await getShortcodesTodayByClient(client_id);

    if (!shortcodes || shortcodes.length === 0) {
      await waClient.sendMessage(
        chatId,
        `❌ Tidak ada konten IG untuk *${client_id}* hari ini.`
      );
      return;
    }

    const hariIndo = [
      "Minggu",
      "Senin",
      "Selasa",
      "Rabu",
      "Kamis",
      "Jumat",
      "Sabtu",
    ];
    const now = new Date();
    const hari = hariIndo[now.getDay()];
    const tanggal = now.toLocaleDateString("id-ID");
    const jam = now.toLocaleTimeString("id-ID", { hour12: false });

    const kontenLinks = shortcodes.map(
      (sc) => `https://www.instagram.com/p/${sc}`
    );
    const totalKonten = shortcodes.length;
    // Require at least 50% of content liked to mark as complete
    const threshold = Math.ceil(totalKonten * 0.5);

    // Rekap likes untuk setiap user: hitung berapa konten yang di-like
    const userStats = {};
    users.forEach((u) => {
      userStats[u.user_id] = { ...u, count: 0 };
    });

    const likesLists = await Promise.all(
      shortcodes.map((sc) => getLikesByShortcode(sc))
    );
    likesLists.forEach((likes) => {
      const likesSet = new Set(
        (likes || []).map((l) => (l || "").toLowerCase())
      );
      users.forEach((u) => {
        if (u.insta && likesSet.has(u.insta.toLowerCase())) {
          userStats[u.user_id].count += 1;
        }
      });
    });

    let sudah = [],
      belum = [];
    Object.values(userStats).forEach((u) => {
      if (u.exception) {
        sudah.push(u); // Selalu masuk sudah, apapun kondisinya
      } else if (
        u.insta &&
        u.insta.trim() !== "" &&
        u.count >= threshold
      ) {
        sudah.push(u);
      } else {
        belum.push(u);
      }
    });

    // Pesan Rekap
    let msg =
      `📋 Rekap Likes Instagram\n*Polres*: *${client_id}*\n${hari}, ${tanggal}\nJam: ${jam}\n` +
      `*Jumlah Konten:* ${totalKonten}\n` +
      `*Daftar link konten hari ini:*\n${kontenLinks.join("\n")}\n\n` +
      `*Jumlah user:* ${users.length}\n` +
      `✅ Sudah melaksanakan: *${sudah.length}*\n` +
      `❌ Belum melaksanakan: *${belum.length}*\n\n`;

    msg += `✅ Sudah melaksanakan (${sudah.length} user):\n`;
    const sudahDiv = groupByDivision(sudah);
    sortDivisionKeys(Object.keys(sudahDiv)).forEach((div) => {
      const list = sudahDiv[div];
      msg += `*${div}* (${list.length} user):\n`;
      msg +=
        list
          .map(
            (u) =>
              `- ${formatNama(u)} : ${u.insta || "belum mengisi data insta"} (${
                u.count
              } konten)${!u.insta ? " (belum mengisi data insta)" : ""}`
          )
          .join("\n") + "\n\n";
    });

    msg += `❌ Belum melaksanakan (${belum.length} user):\n`;
    const belumDiv = groupByDivision(belum);
    sortDivisionKeys(Object.keys(belumDiv)).forEach((div) => {
      const list = belumDiv[div];
      msg += `*${div}* (${list.length} user):\n`;
      msg +=
        list
          .map(
            (u) =>
              `- ${formatNama(u)} : ${
                u.insta ? u.insta : "belum mengisi data insta"
              } (${u.count} konten)${
                !u.insta ? " (belum mengisi data insta)" : ""
              }`
          )
          .join("\n") + "\n\n";
    });

    msg += "\nTerimakasih.";
    await waClient.sendMessage(chatId, msg.trim());
    return;
  }

  // =========================
  // === FETCH KOMENTAR TIKTOK (ADMIN)
  // =========================

  if (text.toLowerCase().startsWith("fetchcomments#")) {
    // Format: fetchcomments#clientid
    const [, client_id_raw] = text.split("#");
    const client_id = (client_id_raw || "").trim().toUpperCase();

    if (!client_id) {
      await waClient.sendMessage(
        chatId,
        "Format salah!\nGunakan: fetchcomments#clientid\nContoh: fetchcomments#POLRESABC"
      );
      return;
    }

    await waClient.sendMessage(
      chatId,
      "⏳ Mengambil & memperbarui data komentar TikTok..."
    );

    // Update komentar TikTok dari API (jika ada handler update komentar)
    try {
      const { getPostsTodayByClient } = await import(
        "../model/tiktokPostModel.js"
      );
      const { fetchAndStoreTiktokComments } = await import(
        "../service/tiktokCommentService.js"
      );
      const posts = await getPostsTodayByClient(client_id);
      for (const post of posts) {
        const video_id = post.video_id || post.id;
        await fetchAndStoreTiktokComments(video_id);
      }
    } catch (e) {
      await waClient.sendMessage(
        chatId,
        `⚠️ Gagal update komentar TikTok dari API: ${e.message}\nAkan menampilkan data dari database terakhir.`
      );
    }

    // Ambil user, post, dan komentar dari database
    const users = await getUsersByClient(client_id);
    const { getPostsTodayByClient } = await import(
      "../model/tiktokPostModel.js"
    );
    const { getCommentsByVideoId } = await import(
      "../model/tiktokCommentModel.js"
    );
    const posts = await getPostsTodayByClient(client_id);

    // Ambil username TikTok client
    let client_tiktok = "-";
    try {
      const { query } = await import("../db/index.js");
      const q =
        "SELECT client_tiktok FROM clients WHERE client_id = $1 LIMIT 1";
      const result = await query(q, [client_id]);
      if (result.rows[0] && result.rows[0].client_tiktok) {
        client_tiktok = result.rows[0].client_tiktok.replace(/^@/, "");
      }
    } catch (err) {}

    if (!posts || posts.length === 0) {
      await waClient.sendMessage(
        chatId,
        `❌ Tidak ada post TikTok untuk *${client_id}* hari ini.`
      );
      return;
    }

    const hariIndo = [
      "Minggu",
      "Senin",
      "Selasa",
      "Rabu",
      "Kamis",
      "Jumat",
      "Sabtu",
    ];
    const now = new Date();
    const hari = hariIndo[now.getDay()];
    const tanggal = now.toLocaleDateString("id-ID");
    const jam = now.toLocaleTimeString("id-ID", { hour12: false });

    const kontenLinks = posts.map(
      (p) =>
        `https://www.tiktok.com/@${client_tiktok}/video/${p.video_id || p.id}`
    );
    const totalKonten = posts.length;

    // Rekap komentar untuk setiap user: hitung berapa video yang sudah dikomentari
    const userStats = {};
    users.forEach((u) => {
      userStats[u.user_id] = { ...u, count: 0 };
    });

    for (const post of posts) {
      const video_id = post.video_id || post.id;
      const komentar = await getCommentsByVideoId(video_id);
      let commentsArr = Array.isArray(komentar?.comments)
        ? komentar.comments
        : [];
      commentsArr = normalizeKomentarArr(commentsArr);
      const usernameSet = new Set(commentsArr);

      users.forEach((u) => {
        const tiktokUsername = (u.tiktok || "").replace(/^@/, "").toLowerCase();
        if (u.tiktok && usernameSet.has(tiktokUsername)) {
          userStats[u.user_id].count += 1;
        }
      });
    }

    let sudah = [],
      belum = [];
    Object.values(userStats).forEach((u) => {
      if (u.exception) {
        sudah.push(u); // Selalu masuk sudah, apapun kondisinya
      } else if (
        u.tiktok &&
        u.tiktok.trim() !== "" &&
        u.count >= Math.ceil(totalKonten / 2)
      ) {
        sudah.push(u);
      } else {
        belum.push(u);
      }
    });

    // Pesan Rekap
    let msg =
      `📋 Rekap Komentar TikTok\n*Polres*: *${client_id}*\n${hari}, ${tanggal}\nJam: ${jam}\n` +
      `*Jumlah Konten:* ${totalKonten}\n` +
      `*Daftar link video hari ini:*\n${kontenLinks.join("\n")}\n\n` +
      `*Jumlah user:* ${users.length}\n` +
      `✅ Sudah melaksanakan: *${sudah.length}*\n` +
      `❌ Belum melaksanakan: *${belum.length}*\n\n`;

    msg += `✅ Sudah melaksanakan (${sudah.length} user):\n`;
    const sudahDiv = groupByDivision(sudah);
    sortDivisionKeys(Object.keys(sudahDiv)).forEach((div) => {
      const list = sudahDiv[div];
      msg += `*${div}* (${list.length} user):\n`;
      msg +=
        list
          .map(
            (u) =>
              `- ${formatNama(u)} : ${
                u.tiktok || "belum mengisi data tiktok"
              } (${u.count} video)${
                !u.tiktok ? " (belum mengisi data tiktok)" : ""
              }`
          )
          .join("\n") + "\n\n";
    });

    msg += `❌ Belum melaksanakan (${belum.length} user):\n`;
    const belumDiv = groupByDivision(belum);
    sortDivisionKeys(Object.keys(belumDiv)).forEach((div) => {
      const list = belumDiv[div];
      msg += `*${div}* (${list.length} user):\n`;
      msg +=
        list
          .map(
            (u) =>
              `- ${formatNama(u)} : ${
                u.tiktok ? u.tiktok : "belum mengisi data tiktok"
              } (0 video)${!u.tiktok ? " (belum mengisi data tiktok)" : ""}`
          )
          .join("\n") + "\n\n";
    });

    msg += "\nTerimakasih.";
    await waClient.sendMessage(chatId, msg.trim());
    return;
  }

  // =========================
  // === IG: ABSENSI LIKES
  // =========================
  if (text.toLowerCase().startsWith("absensilikes#")) {
    const parts = text.split("#");
    if (parts.length < 2) {
      await waClient.sendMessage(
        chatId,
        "Format salah!\nabsensilikes#clientid#[sudah|belum|akumulasi#sudah|akumulasi#belum]"
      );
      return;
    }
    const client_id = (parts[1] || "").trim();
    const filter1 = (parts[2] || "").toLowerCase();
    const filter2 = (parts[3] || "").toLowerCase();

    // Optional: always update konten sebelum rekap (atau masukkan ke dalam helper kalau mau DRY full)
    try {
      await fetchAndStoreInstaContent(null, waClient, chatId, client_id);
    } catch (e) {
      await waClient.sendMessage(
        chatId,
        `⚠️ Gagal update konten IG: ${e.message}\nAbsensi tetap dilanjutkan dengan data terakhir di database.`
      );
    }

    try {
      let msg = "";
      if (filter1 === "akumulasi") {
        if (filter2 === "sudah") {
          msg = await absensiLikes(client_id, { mode: "sudah" });
        } else if (filter2 === "belum") {
          msg = await absensiLikes(client_id, { mode: "belum" });
        } else {
          msg = await absensiLikes(client_id, { mode: "all" });
        }
      } else if (["sudah", "belum", ""].includes(filter1)) {
        if (filter1 === "sudah") {
          msg = await absensiLikesPerKonten(client_id, { mode: "sudah" });
        } else if (filter1 === "belum") {
          msg = await absensiLikesPerKonten(client_id, { mode: "belum" });
        } else {
          msg = await absensiLikesPerKonten(client_id, { mode: "all" });
        }
      } else {
        await waClient.sendMessage(
          chatId,
          "Format salah! Pilih mode [akumulasi|sudah|belum], contoh:\nabsensilikes#clientid#akumulasi#sudah"
        );
        return;
      }
      await waClient.sendMessage(chatId, msg || "Data tidak ditemukan.");
    } catch (err) {
      await waClient.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
    return;
  }

  // =========================
  // === TIKTOK: ABSENSI KOMENTAR
  // =========================

  if (text.toLowerCase().startsWith("absensikomentar#")) {
    const parts = text.split("#");
    if (parts.length < 2) {
      await waClient.sendMessage(
        chatId,
        "Format salah!\nabsensikomentar#clientid#[sudah|belum|akumulasi#sudah|akumulasi#belum]"
      );
      return;
    }
    const client_id = (parts[1] || "").trim();
    const filter1 = (parts[2] || "").toLowerCase();
    const filter2 = (parts[3] || "").toLowerCase();

    try {
      let msg = "";
      // === Akumulasi Mode ===
      if (filter1 === "akumulasi") {
        if (filter2 === "sudah") {
          msg = await absensiKomentar(client_id, { mode: "sudah" });
        } else if (filter2 === "belum") {
          msg = await absensiKomentar(client_id, { mode: "belum" });
        } else {
          msg = await absensiKomentar(client_id, { mode: "all" });
        }
      }
      // === Per-Konten Mode ===
      else if (["sudah", "belum", ""].includes(filter1)) {
        if (filter1 === "sudah") {
          msg = await absensiKomentarTiktokPerKonten(client_id, {
            mode: "sudah",
          });
        } else if (filter1 === "belum") {
          msg = await absensiKomentarTiktokPerKonten(client_id, {
            mode: "belum",
          });
        } else {
          msg = await absensiKomentarTiktokPerKonten(client_id, {
            mode: "all",
          });
        }
      } else {
        await waClient.sendMessage(
          chatId,
          "Format salah! Pilih mode [akumulasi|sudah|belum], contoh:\nabsensikomentar#clientid#akumulasi#sudah"
        );
        return;
      }
      await waClient.sendMessage(chatId, msg || "Data tidak ditemukan.");
    } catch (err) {
      await waClient.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
    return;
  }

  // =========================
  // === MIGRASI DARI GOOGLE SHEET (ADMIN)
  // =========================
  if (text.toLowerCase().startsWith("sheettransfer#")) {
    const [, client_id, ...linkParts] = text.split("#");
    const sheetUrl = linkParts.join("#").trim();
    if (!client_id || !sheetUrl) {
      await waClient.sendMessage(
        chatId,
        "Format: sheettransfer#clientid#link_google_sheet"
      );
      return;
    }
    const check = await checkGoogleSheetCsvStatus(sheetUrl);
    if (!check.ok) {
      await waClient.sendMessage(
        chatId,
        `❌ Sheet tidak bisa diakses:\n${check.reason}`
      );
      return;
    }
    await waClient.sendMessage(
      chatId,
      `⏳ Mengambil & migrasi data dari Google Sheet...`
    );
    try {
      const result = await importUsersFromGoogleSheet(sheetUrl, client_id);
      let report = `*Hasil import user ke client ${client_id}:*\n`;
      result.forEach((r) => {
        report += `- ${r.user_id}: ${r.status}${
          r.error ? " (" + r.error + ")" : ""
        }\n`;
      });
      await waClient.sendMessage(chatId, report);
    } catch (err) {
      await waClient.sendMessage(chatId, `❌ Gagal import: ${err.message}`);
    }
    return;
  }

  // =========================
  // === UPDATE client_group dari WhatsApp GROUP
  // =========================
  if (text.toLowerCase().startsWith("thisgroup#")) {
    if (!msg.from.endsWith("@g.us")) {
      await waClient.sendMessage(
        chatId,
        "❌ Perintah ini hanya bisa digunakan di dalam group WhatsApp!"
      );
      return;
    }
    const [, rawClientId] = text.split("#");
    const client_id = (rawClientId || "").trim();
    if (!client_id) {
      await waClient.sendMessage(
        chatId,
        "Format salah!\nGunakan: thisgroup#ClientID"
      );
      return;
    }
    const groupId = msg.from;
    try {
      const updated = await clientService.updateClient(client_id, {
        client_group: groupId,
      });
      if (updated) {
        let groupName = "";
        try {
          const groupData = await waClient.getChatById(groupId);
          if (groupData && groupData.name) {
            groupName = `\nNama Group: *${groupData.name}*`;
          }
        } catch (e) {
          console.warn('[WA] Failed to get group name:', e?.message || e);
        }
        let dataText = `✅ Group ID berhasil disimpan untuk *${client_id}*:\n*${groupId}*${groupName}`;
        await waClient.sendMessage(senderId, dataText);
        await waClient.sendMessage(
          chatId,
          "✅ Group ID telah dikirim ke chat pribadi Anda."
        );
        if (updated.client_operator && updated.client_operator.length >= 8) {
          const operatorId = formatToWhatsAppId(updated.client_operator);
          if (operatorId !== senderId) {
            await waClient.sendMessage(
              operatorId,
              `[Notifikasi]: Client group *${client_id}* diupdate ke group ID: ${groupId}`
            );
          }
        }

        await refreshGatewayAllowedGroups("client group updated via thisgroup").catch(
          () => {}
        );
      } else {
        await waClient.sendMessage(
          chatId,
          `❌ Client dengan ID ${client_id} tidak ditemukan!`
        );
      }
    } catch (err) {
      await waClient.sendMessage(
        chatId,
        `❌ Gagal update client_group: ${err.message}`
      );
    }
    return;
  }

  // =========================
  // === ADD NEW CLIENT (ADMIN)
  // =========================
  if (text.toLowerCase().startsWith("addnewclient#")) {
    const [cmd, client_id, nama] = text.split("#");
    if (!client_id || !nama) {
      await waClient.sendMessage(
        chatId,
        "Format salah!\nGunakan: addnewclient#clientid#clientname"
      );
      return;
    }
    try {
      const newClient = await clientService.createClient({
        client_id,
        nama,
        client_type: "",
        client_status: true,
        client_insta: "",
        client_insta_status: false,
        client_tiktok: "",
        client_tiktok_status: false,
        client_operator: "",
        client_super: "",
        client_group: "",
        tiktok_secuid: "",
      });

      let dataText = formatClientData(
        newClient,
        `✅ Data Client *${newClient.client_id}* berhasil ditambah:`
      );
      await waClient.sendMessage(chatId, dataText);

      if (newClient.client_operator && newClient.client_operator.length >= 8) {
        const operatorId = formatToWhatsAppId(newClient.client_operator);
        if (operatorId !== chatId) {
          await waClient.sendMessage(operatorId, `[Notifikasi]:\n${dataText}`);
        }
      }

      await refreshGatewayAllowedGroups("client added via WA").catch(() => {});
    } catch (err) {
      await waClient.sendMessage(
        chatId,
        `❌ Gagal tambah client: ${err.message}`
      );
    }
    return;
  }

  // =========================
  // === UPDATE CLIENT (ADMIN)
  // =========================
  if (text.toLowerCase().startsWith("updateclient#")) {
    const parts = text.split("#");

    // === OTOMATIS UPDATE tiktok_secuid ===
    if (parts.length === 3 && parts[2] === "tiktok_secuid") {
      const [, client_id, key] = parts;
      try {
        const client = await clientService.findClientById(client_id);
        if (!client) {
          await waClient.sendMessage(
            chatId,
            `❌ Client dengan ID ${client_id} tidak ditemukan!`
          );
          return;
        }
        let username = client.client_tiktok || "";
        if (!username) {
          await waClient.sendMessage(
            chatId,
            `❌ Username TikTok belum diisi pada client dengan ID ${client_id}.`
          );
          return;
        }
        const secUid = await getTiktokSecUid(username);
        const updated = await clientService.updateClient(client_id, {
          tiktok_secuid: secUid,
        });
        if (updated) {
          let dataText = formatClientData(
            updated,
            `✅ tiktok_secuid untuk client *${client_id}* berhasil diupdate dari username *@${username}*:\n\n*secUid*: ${secUid}\n\n*Data Terbaru:*`
          );
          await waClient.sendMessage(chatId, dataText);
          if (updated.client_operator && updated.client_operator.length >= 8) {
            const operatorId = formatToWhatsAppId(updated.client_operator);
            if (operatorId !== chatId) {
              await waClient.sendMessage(
                operatorId,
                `[Notifikasi]:\n${dataText}`
              );
            }
          }

          await refreshGatewayAllowedGroups(
            "client updated via tiktok_secuid refresh"
          ).catch(() => {});
        } else {
          await waClient.sendMessage(
            chatId,
            `❌ Gagal update secUid ke client.`
          );
        }
      } catch (err) {
        await waClient.sendMessage(chatId, `❌ Gagal proses: ${err.message}`);
      }
      return;
    }

    // === UPDATE FIELD BIASA ===
    if (parts.length >= 4) {
      const [, client_id, key, ...valueParts] = parts;
      const value = valueParts.join("#");
      try {
        const updateObj = {};
        if (
          [
            "client_status",
            "client_insta_status",
            "client_tiktok_status",
          ].includes(key)
        ) {
          updateObj[key] = value === "true";
        } else if (key === "client_tiktok" || key === "client_insta") {
          updateObj[key] = value;
        } else {
          updateObj[key] = value;
        }
        const updated = await clientService.updateClient(client_id, updateObj);

        if (updated) {
          let dataText = formatClientData(
            updated,
            `✅ Data Client *${client_id}* berhasil diupdate:`
          );
          await waClient.sendMessage(chatId, dataText);

          if (updated.client_operator && updated.client_operator.length >= 8) {
            const operatorId = formatToWhatsAppId(updated.client_operator);
            if (operatorId !== chatId) {
              await waClient.sendMessage(
                operatorId,
                `[Notifikasi]:\n${dataText}`
              );
            }
          }

          await refreshGatewayAllowedGroups("client updated via WA").catch(
            () => {}
          );
        } else {
          await waClient.sendMessage(
            chatId,
            `❌ Client dengan ID ${client_id} tidak ditemukan!`
          );
        }
      } catch (err) {
        await waClient.sendMessage(
          chatId,
          `❌ Gagal update client: ${err.message}`
        );
      }
      return;
    }

    // FORMAT SALAH
    await waClient.sendMessage(
      chatId,
      "Format salah!\n" +
        "updateclient#clientid#key#value\n" +
        "atau updateclient#clientid#tiktok_secuid (untuk update secUid otomatis dari username TikTok)"
    );
    return;
  }

  // =========================
  // === GET CLIENT INFO (ADMIN)
  // =========================
  if (text.toLowerCase().startsWith("clientinfo#")) {
    const [, client_id_raw] = text.split("#");
    const client_id = (client_id_raw || "").trim();
    // Jika tidak ada client_id: tampilkan daftar semua client
    if (!client_id) {
      try {
        // Pastikan fungsi ini sudah diekspor dari clientService.js
        const { getAllClientIds } = await import("../service/clientService.js");
        const list = await getAllClientIds();
        if (!list.length) {
          await waClient.sendMessage(chatId, "Belum ada client terdaftar.");
          return;
        }
        let msg = "*Daftar Client Terdaftar:*\n";
        msg += list
          .map(
            (c, i) =>
              `${i + 1}. *${c.client_id}* - ${c.nama || "-"} [${
                c.status ? "AKTIF" : "TIDAK AKTIF"
              }]`
          )
          .join("\n");
        msg += "\n\nKetik: clientinfo#clientid\nContoh: clientinfo#JAKARTA";
        await waClient.sendMessage(chatId, msg);
      } catch (e) {
        await waClient.sendMessage(
          chatId,
          "Gagal mengambil daftar client: " + e.message
        );
      }
      return;
    }

    // Lanjut: clientinfo#clientid
    try {
      const client = await clientService.findClientById(client_id);
      if (client) {
        let dataText = formatClientData(
          client,
          `ℹ️ Info Data Client *${client_id}*:\n`
        );
        await waClient.sendMessage(chatId, dataText);

        if (client.client_operator && client.client_operator.length >= 8) {
          const operatorId = formatToWhatsAppId(client.client_operator);
          if (operatorId !== chatId) {
            await waClient.sendMessage(
              operatorId,
              `[Notifikasi Client Info]:\n${dataText}`
            );
          }
        }
      } else {
        await waClient.sendMessage(
          chatId,
          `❌ Client dengan ID ${client_id} tidak ditemukan!`
        );
      }
    } catch (err) {
      await waClient.sendMessage(
        chatId,
        `❌ Gagal mengambil data client: ${err.message}`
      );
    }
    return;
  }

  // =========================
  // === REMOVE CLIENT (ADMIN)
  // =========================
  if (text.toLowerCase().startsWith("removeclient#")) {
    const [, client_id] = text.split("#");
    if (!client_id) {
      await waClient.sendMessage(
        chatId,
        "Format salah!\nGunakan: removeclient#clientid"
      );
      return;
    }
    try {
      const removed = await clientService.deleteClient(client_id);
      if (removed) {
        let dataText = formatClientData(
          removed,
          `🗑️ Client *${client_id}* berhasil dihapus!\nData sebelumnya:\n`
        );
        await waClient.sendMessage(chatId, dataText);

        if (removed.client_operator && removed.client_operator.length >= 8) {
          const operatorId = formatToWhatsAppId(removed.client_operator);
          if (operatorId !== chatId) {
            await waClient.sendMessage(
              operatorId,
              `[Notifikasi]:\n${dataText}`
            );
          }
        }
      } else {
        await waClient.sendMessage(
          chatId,
          `❌ Client dengan ID ${client_id} tidak ditemukan!`
        );
      }
    } catch (err) {
      await waClient.sendMessage(
        chatId,
        `❌ Gagal hapus client: ${err.message}`
      );
    }
    return;
  }

  // =========================
  // === MIGRASI USER DARI FOLDER (ADMIN)
  // =========================
  if (text.toLowerCase().startsWith("transferuser#")) {
    const [, client_id] = text.split("#");
    if (!client_id) {
      await waClient.sendMessage(
        chatId,
        "Format salah!\nGunakan: transferuser#clientid"
      );
      return;
    }
    await waClient.sendMessage(
      chatId,
      `⏳ Migrasi user dari user_data/${client_id}/ ...`
    );
    try {
      const result = await migrateUsersFromFolder(client_id);
      let report = `*Hasil transfer user dari client ${client_id}:*\n`;
      result.forEach((r) => {
        report += `- ${r.file}: ${r.status}${
          r.error ? " (" + r.error + ")" : ""
        }\n`;
      });

      if (result.length > 0 && result.every((r) => r.status === "✅ Sukses")) {
        report += "\n🎉 Semua user berhasil ditransfer!";
      }
      if (result.length === 0) {
        report += "\n(Tidak ada file user yang ditemukan atau diproses)";
      }

      await waClient.sendMessage(chatId, report);
    } catch (err) {
      await waClient.sendMessage(
        chatId,
        `❌ Gagal proses transfer: ${err.message}`
      );
    }
    return;
  }

  // =========================
  // === APPROVE / DENY SUBSCRIPTION
  // =========================
  if (text.toLowerCase().startsWith("grantsub#")) {
    const [, id] = text.split("#");
    if (!id) {
      await waClient.sendMessage(chatId, "Format salah! Gunakan: grantsub#id");
      return;
    }
    const reqRow = await premiumReqModel.findRequestById(Number(id));
    if (!reqRow || reqRow.status !== "pending") {
      await waClient.sendMessage(chatId, `❌ Request ${id} tidak valid.`);
      return;
    }
    await premiumReqModel.updateRequest(Number(id), { status: "approved" });
    await premiumService.grantPremium(reqRow.user_id);
    await waClient.sendMessage(chatId, `✅ Request ${id} disetujui.`);
    const user = await userModel.findUserById(reqRow.user_id);
    if (user?.whatsapp) {
      await safeSendMessage(
        waClient,
        formatToWhatsAppId(user.whatsapp),
        "✅ Langganan premium Anda aktif."
      );
    }
    return;
  }

  if (text.toLowerCase().startsWith("denysub#")) {
    const [, id] = text.split("#");
    if (!id) {
      await waClient.sendMessage(chatId, "Format salah! Gunakan: denysub#id");
      return;
    }
    const reqRow = await premiumReqModel.findRequestById(Number(id));
    if (!reqRow || reqRow.status !== "pending") {
      await waClient.sendMessage(chatId, `❌ Request ${id} tidak valid.`);
      return;
    }
    await premiumReqModel.updateRequest(Number(id), { status: "rejected" });
    await waClient.sendMessage(chatId, `❌ Request ${id} ditolak.`);
    const user = await userModel.findUserById(reqRow.user_id);
    if (user?.whatsapp) {
      await safeSendMessage(
        waClient,
        formatToWhatsAppId(user.whatsapp),
        "❌ Permintaan langganan Anda ditolak."
      );
    }
    return;
  }

  // ========== Fallback Handler ==========
  const isFirstTime = !knownUserSet.has(userWaNum);
  knownUserSet.add(userWaNum);

  let clientInfoText = "";
  let operatorRow = null;
  let superAdminRow = null;
  const normalizedUserWaId = userWaNum
    ? userWaNum.startsWith("62")
      ? userWaNum
      : "62" + userWaNum.replace(/^0/, "")
    : "";
  try {
    const q = `SELECT client_id, nama, client_operator FROM clients WHERE client_operator=$1 LIMIT 1`;
    const res = normalizedUserWaId ? await query(q, [normalizedUserWaId]) : null;
    operatorRow = res?.rows?.[0] || null;
    if (operatorRow) {
      const operatorContact =
        operatorRow.client_operator ||
        operatorRow.client_super ||
        normalizedUserWaId;
      const waOperator = String(operatorContact).replace(/\D/g, "");
      clientInfoText =
        `\n\nHubungi operator Anda:\n` +
        `*${operatorRow.nama || operatorRow.client_id}* (WA: https://wa.me/${waOperator})`;
    }
  } catch (e) {
    clientInfoText = "";
  }

  if (isFirstTime) {
    if (isAdmin) {
      adminOptionSessions[chatId] = {};
      setAdminOptionTimeout(chatId);
      const salam = getGreeting();
        await safeSendMessage(
          waClient,
          chatId,
          `${salam}! Nomor ini terdaftar sebagai *admin*.` +
            "\n1️⃣ Menu Client" +
            "\n2️⃣ Menu Operator" +
            "\n3️⃣ Perubahan Data Username" +
            "\nBalas angka *1*, *2*, atau *3*."
        );
      return;
    }
    if (!operatorRow && normalizedUserWaId) {
      superAdminRow = await findBySuperAdmin(normalizedUserWaId);
    }
    const accessRow = operatorRow || superAdminRow;
    if (accessRow) {
      operatorOptionSessions[chatId] = {};
      setOperatorOptionTimeout(chatId);
      const salam = getGreeting();
      const roleLabel = operatorRow ? "operator" : "super admin";
      await safeSendMessage(
        waClient,
        chatId,
        `${salam}! Nomor ini terdaftar sebagai *${roleLabel}* untuk client *${
          accessRow.nama || accessRow.client_id
        }*.` +
          "\n1️⃣ Menu Operator" +
          "\n2️⃣ Perubahan Data Username" +
          "\nBalas angka *1* atau *2*."
      );
      return;
    }
    if (!allowUserMenu) {
      return;
    }
    const pengirim = chatId.replace(/[^0-9]/g, "");
    const userByWA = await userModel.findUserByWhatsApp(pengirim);
    const salam = getGreeting();
    if (userByWA) {
      userMenuContext[chatId] = {
        step: "confirmUserByWaUpdate",
        user_id: userByWA.user_id,
      };
      const msg = `${salam}, Bapak/Ibu\n${formatUserSummary(userByWA)}\n\nApakah Anda ingin melakukan perubahan data?\nBalas *ya* untuk memulai update atau *tidak* untuk melewati.`;
      await safeSendMessage(waClient, chatId, msg.trim());
      setMenuTimeout(
        chatId,
        waClient,
        shouldExpectQuickReply(userMenuContext[chatId])
      );
    } else {
      userMenuContext[chatId] = { step: "inputUserId" };
      const msg =
        `${salam}! Nomor WhatsApp Anda belum terdaftar.` +
        clientInfoText +
        "\n\nUntuk menampilkan data Anda, balas dengan NRP (hanya angka)." +
        "\nKetik *batal* untuk keluar." +
        "\n\nContoh:\n87020990";
      await safeSendMessage(waClient, chatId, msg.trim());
      setMenuTimeout(
        chatId,
        waClient,
        shouldExpectQuickReply(userMenuContext[chatId])
      );
    }
    return;
  }

  // Proses binding WhatsApp jika nomor belum terdaftar
  const senderWa = chatId.replace(/[^0-9]/g, "");
  const userByWAExist = await userModel.findUserByWhatsApp(senderWa);

  if (!userByWAExist) {
    if (!allowUserMenu) {
      delete waBindSessions[chatId];
      return;
    }
    if (waBindSessions[chatId]) {
      const session = waBindSessions[chatId];
      if (session.step === "ask_nrp") {
        if (text.trim().toLowerCase() === "batal") {
          delete waBindSessions[chatId];
          await waClient.sendMessage(chatId, "Proses dibatalkan. Silakan masukkan NRP Anda untuk memulai.");
          waBindSessions[chatId] = { step: "ask_nrp" };
          setBindTimeout(chatId);
          return;
        }
        const lower = text.trim().toLowerCase();
        if (lower === "userrequest") {
          await waClient.sendMessage(
            chatId,
            "Panduan:\n1. Ketik NRP Anda (angka saja) untuk mendaftar." +
              "\n2. Balas *batal* untuk membatalkan proses."
          );
          return;
        }
        const nrp = text.trim();
        if (!/^\d+$/.test(nrp)) {
          await waClient.sendMessage(
            chatId,
            "Balas pesan ini dengan NRP Anda, \n*Contoh Pesan Balasan : 87020990*"
          );
          return;
        }
        const user = await userModel.findUserById(nrp);
        if (!user) {
          await waClient.sendMessage(chatId, `❌ NRP *${nrp}* tidak ditemukan. Jika yakin benar, hubungi Opr Humas Polres Anda.`);
          return;
        }
        session.step = "confirm";
        session.user_id = user.user_id;
        setBindTimeout(chatId);
        await waClient.sendMessage(
          chatId,
          `Apakah Anda ingin menghubungkan nomor WhatsApp ini dengan NRP *${nrp}*?\n` +
            "Satu username hanya bisa menggunakan satu akun WhatsApp.\n" +
            "Balas *ya* untuk menyetujui atau *tidak* untuk membatalkan."
        );
        return;
      }
      if (session.step === "confirm") {
        if (text.trim().toLowerCase() === "ya") {
          const nrp = session.user_id;
          await userModel.updateUserField(nrp, "whatsapp", senderWa);
          const user = await userModel.findUserById(nrp);
          await waClient.sendMessage(
            chatId,
            `✅ Nomor WhatsApp berhasil dihubungkan ke NRP *${nrp}*.\n` +
              `${formatUserSummary(user)}`
          );
          delete waBindSessions[chatId];
          return;
        }
        if (text.trim().toLowerCase() === "tidak") {
          delete waBindSessions[chatId];
          await waClient.sendMessage(chatId, "Baik, proses dibatalkan. Silakan masukkan NRP Anda untuk melanjutkan.");
          waBindSessions[chatId] = { step: "ask_nrp" };
          setBindTimeout(chatId);
          return;
        }
        await waClient.sendMessage(chatId, "Balas *ya* untuk menyetujui, atau *tidak* untuk membatalkan.");
        return;
      }
    } else {
      waBindSessions[chatId] = { step: "ask_nrp" };
      setBindTimeout(chatId);
      await waClient.sendMessage(
        chatId,
        "🤖 Maaf, perintah yang Anda kirim belum dikenali. Silakan masukkan NRP Anda untuk melanjutkan proses binding akun atau balas *batal* untuk keluar:"
      );
      return;
    }
  }

  // Untuk user lama (pesan tidak dikenal)
  const helpInstruction = allowUserMenu
    ? "Untuk melihat daftar perintah dan bantuan penggunaan, silakan ketik *userrequest*."
    : "Untuk melihat daftar perintah dan bantuan penggunaan, silakan hubungi nomor *WA-USER* dan ketik *userrequest*.";
  await waClient.sendMessage(
    chatId,
    "🤖 Maaf, perintah yang Anda kirim belum dikenali oleh sistem.\n\n" +
      helpInstruction +
      clientInfoText
  );
  console.log(`${clientLabel} Message from ${chatId} processed with fallback handler`);
  return;
    };

    try {
      await processMessage();
    } finally {
      if (allowUserMenu) {
        const reminder = await computeMutualReminder();
        const hasSessionNow = hasAnySession();
        if (
          reminder.shouldRemind &&
          reminder.message &&
          hadSessionAtStart &&
          !hasSessionNow
        ) {
          try {
            await waClient.sendMessage(chatId, reminder.message);
          } catch (err) {
            console.warn(
              `${clientLabel} failed to send mutual reminder to ${chatId}: ${err?.message || err}`
            );
          }
        }
      }
    }
  };
}

const handleMessage = createHandleMessage(waClient, {
  allowUserMenu: false,
  clientLabel: "[WA]",
});
const handleUserMessage = createHandleMessage(waUserClient, {
  allowUserMenu: true,
  clientLabel: "[WA-USER]",
});

async function processGatewayBulkDeletion(chatId, text) {
  const existingSession = getSession(chatId);
  const session =
    existingSession?.menu === "clientrequest"
      ? existingSession
      : { menu: "clientrequest", step: "bulkStatus_process" };
  setSession(chatId, session);
  await processBulkDeletionRequest({
    session: getSession(chatId),
    chatId,
    text,
    waClient: waGatewayClient,
    userModel,
  });
}

const gatewayAllowedGroupIds = new Set();
const gatewayAllowedGroupState = {
  isLoaded: false,
  isDirty: true,
  loadingPromise: null,
  lastRefreshedAt: 0,
};

function normalizeGatewayGroupId(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed.endsWith("@g.us") ? trimmed : null;
}

export async function refreshGatewayAllowedGroups(reason = "") {
  if (gatewayAllowedGroupState.loadingPromise) {
    return gatewayAllowedGroupState.loadingPromise;
  }

  const loader = (async () => {
    try {
      const res = await query(
        `SELECT client_group FROM clients
         WHERE client_status = true
           AND client_group IS NOT NULL
           AND client_group <> ''`
      );
      const normalizedGroups = (res.rows || [])
        .map((row) => normalizeGatewayGroupId(row.client_group))
        .filter(Boolean);

      gatewayAllowedGroupIds.clear();
      normalizedGroups.forEach((groupId) =>
        gatewayAllowedGroupIds.add(groupId)
      );

      gatewayAllowedGroupState.isLoaded = true;
      gatewayAllowedGroupState.isDirty = false;
      gatewayAllowedGroupState.lastRefreshedAt = Date.now();

      console.log(
        `[WA-GATEWAY] Loaded ${gatewayAllowedGroupIds.size} allowed group(s)${
          reason ? ` (${reason})` : ""
        }`
      );
    } catch (err) {
      console.error(
        `[WA-GATEWAY] Failed to load allowed gateway groups${
          reason ? ` (${reason})` : ""
        }: ${err?.message || err}`
      );
      gatewayAllowedGroupState.isLoaded = gatewayAllowedGroupIds.size > 0;
    } finally {
      gatewayAllowedGroupState.loadingPromise = null;
    }
  })();

  gatewayAllowedGroupState.loadingPromise = loader;
  return loader;
}

export function markGatewayAllowedGroupsDirty() {
  gatewayAllowedGroupState.isDirty = true;
}

async function ensureGatewayAllowedGroupsLoaded(reason = "") {
  if (!gatewayAllowedGroupState.isLoaded || gatewayAllowedGroupState.isDirty) {
    await refreshGatewayAllowedGroups(reason).catch(() => {});
    return;
  }

  const maxCacheAgeMs = 10 * 60 * 1000;
  if (Date.now() - gatewayAllowedGroupState.lastRefreshedAt > maxCacheAgeMs) {
    await refreshGatewayAllowedGroups("periodic refresh").catch(() => {});
  }
}

// Preload allowlist in the background for faster gateway readiness
refreshGatewayAllowedGroups("initial warmup").catch(() => {});

export async function handleGatewayMessage(msg) {
  const readinessState = getClientReadinessState(waGatewayClient, "WA-GATEWAY");
  if (!readinessState.ready) {
    waGatewayClient
      .waitForWaReady()
      .catch((err) => {
        console.warn(
          `[WA-GATEWAY] waitForWaReady failed before message handling: ${err?.message || err}`
        );
      });
    readinessState.pendingMessages.push({ msg, allowReplay: true });
    console.log(
      `[WA-GATEWAY] Deferred gateway message from ${msg?.from || "unknown"} until ready`
    );
    return;
  }

  const chatId = msg.from || "";
  const text = (msg.body || "").trim();
  if (!text) return;

  await ensureGatewayAllowedGroupsLoaded("gateway message");

  const isStatusBroadcast = chatId === "status@broadcast";

  if (isStatusBroadcast) {
    console.log("[WA-GATEWAY] Ignored status broadcast message");
    return;
  }

  if (chatId.endsWith("@g.us") && !gatewayAllowedGroupIds.has(chatId)) {
    console.log(`[WA-GATEWAY] Ignored group message from ${chatId}`);
    return;
  }

  const senderId = msg.author || chatId;
  const normalizedText = text.trim().toLowerCase();
  const isGatewayForward = isGatewayComplaintForward({
    senderId,
    text,
    allowImplicitGatewayForward: true,
  });
  const isAdmin = isAdminWhatsApp(senderId);
  const initialIsMyContact =
    typeof msg.isMyContact === "boolean" ? msg.isMyContact : null;
  const session = getSession(chatId);

  if (session?.menu === "satbinmasofficial_gateway") {
    const lowered = normalizedText;
    const targetClientId = session.targetClientId;

    if (lowered === "ya") {
      const nextSession = {
        menu: "clientrequest",
        step: "satbinmasOfficial_promptRole",
        selected_client_id: targetClientId,
        satbinmasOfficialDraft: {
          ...(session.satbinmasOfficialDraft || {}),
          targetClientId,
        },
      };

      setSession(chatId, nextSession);
      await runMenuHandler({
        handlers: clientRequestHandlers,
        menuName: "clientrequest",
        session: getSession(chatId),
        chatId,
        text: "",
        waClient: waGatewayClient,
        clientLabel: "[WA-GATEWAY]",
        args: [pool, userModel, clientService],
        invalidStepMessage:
          "⚠️ Sesi menu client tidak dikenali. Ketik *clientrequest* ulang atau *batal*.",
        failureMessage:
          "❌ Terjadi kesalahan pada menu client. Ketik *clientrequest* ulang untuk memulai kembali.",
      });
      return;
    }

    if (lowered === "batal") {
      clearSession(chatId);
      await waGatewayClient.sendMessage(
        chatId,
        "Baik, penambahan akun resmi Satbinmas dibatalkan."
      );
      return;
    }

    await waGatewayClient.sendMessage(
      chatId,
      session.prompt ||
        "Belum ada akun resmi yang terdaftar. Balas *ya* untuk menambahkan akun resmi Satbinmas atau *batal* untuk membatalkan."
    );
    return;
  }

  const handledClientRequestSession = await handleClientRequestSessionStep({
    session,
    chatId,
    text,
    waClient: waGatewayClient,
    clientLabel: "[WA-GATEWAY]",
    pool,
    userModel,
    clientService,
    migrateUsersFromFolder,
    checkGoogleSheetCsvStatus,
    importUsersFromGoogleSheet,
    fetchAndStoreInstaContent,
    fetchAndStoreTiktokContent,
    formatClientData,
    handleFetchLikesInstagram,
    handleFetchKomentarTiktokBatch,
  });
  if (handledClientRequestSession) return;

  if (normalizedText.startsWith("#satbinmasofficial")) {
    if (!isGatewayForward) {
      await waGatewayClient.sendMessage(
        chatId,
        "❌ Permintaan ini hanya diproses untuk pesan yang diteruskan melalui WA Gateway."
      );
      return;
    }

    // Check if user is admin
    if (!senderId || !isAdminWhatsApp(senderId)) {
      await waGatewayClient.sendMessage(
        chatId,
        "❌ Fitur ini hanya tersedia untuk administrator."
      );
      return;
    }

    // Note: This feature previously relied on dashboard_user for client_id mapping.
    // After dashboard removal, admins need to specify client_id explicitly.
    // TODO: Implement client_id selection mechanism for satbinmas official account management
    await waGatewayClient.sendMessage(
      chatId,
      "ℹ️ Fitur ini sedang dalam perbaikan setelah penghapusan sistem dashboard.\n" +
      "Untuk sementara, silakan hubungi developer untuk konfigurasi akun resmi Satbinmas."
    );
    return;
  }

  if (isGatewayComplaintForward({ senderId, text })) {
    console.log("[WA-GATEWAY] Skipped gateway-forwarded complaint message");
    return;
  }

  const handledComplaint = await handleComplaintMessageIfApplicable({
    text,
    allowUserMenu: false,
    session,
    isAdmin,
    initialIsMyContact,
    senderId,
    chatId,
    adminOptionSessions,
    setSession,
    getSession,
    waClient: waGatewayClient,
    pool,
    userModel,
  });

  if (!handledComplaint) {
    await processGatewayBulkDeletion(chatId, text);
  }
}

registerClientMessageHandler(waClient, "wwebjs", handleMessage);
registerClientMessageHandler(waUserClient, "wwebjs-user", handleUserMessage);
registerClientMessageHandler(waGatewayClient, "wwebjs-gateway", handleGatewayMessage);

if (shouldInitWhatsAppClients) {
  startReadinessDiagnosticsLogger();
  writeWaStructuredLog("info", buildWaStructuredLog({ label: "WA", event: "wa_message_listener_attach_start" }));
  
  waClient.on('message', (msg) => {
    writeWaStructuredLog(
      "debug",
      buildWaStructuredLog({
        clientId: waClient?.clientId || null,
        label: "WA",
        event: "message_received",
        jid: msg?.from || null,
        messageId: msg?.id?._serialized || msg?.id?.id || null,
      }),
      { debugOnly: true }
    );
    handleIncoming('baileys', msg, handleMessage);
  });

  waUserClient.on('message', (msg) => {
    const from = msg.from || '';
    if (from.endsWith('@g.us') || from === 'status@broadcast') {
      writeWaStructuredLog(
        "debug",
        buildWaStructuredLog({
          clientId: waUserClient?.clientId || null,
          label: "WA-USER",
          event: "message_ignored",
          jid: from || null,
          errorCode: "GROUP_OR_STATUS",
        }),
        { debugOnly: true }
      );
      return;
    }
    writeWaStructuredLog(
      "debug",
      buildWaStructuredLog({
        clientId: waUserClient?.clientId || null,
        label: "WA-USER",
        event: "message_received",
        jid: msg?.from || null,
        messageId: msg?.id?._serialized || msg?.id?.id || null,
      }),
      { debugOnly: true }
    );
    handleIncoming('baileys-user', msg, handleUserMessage);
  });

  waGatewayClient.on('message', (msg) => {
    writeWaStructuredLog(
      "debug",
      buildWaStructuredLog({
        clientId: waGatewayClient?.clientId || null,
        label: "WA-GATEWAY",
        event: "message_received",
        jid: msg?.from || null,
        messageId: msg?.id?._serialized || msg?.id?.id || null,
      }),
      { debugOnly: true }
    );
    handleIncoming('baileys-gateway', msg, handleGatewayMessage);
  });

  writeWaStructuredLog("info", buildWaStructuredLog({ label: "WA", event: "wa_message_listener_attach_ready" }));
  writeWaStructuredLog(
    "debug",
    buildWaStructuredLog({
      label: "WA",
      event: "wa_message_listener_count",
      waClientCount: waClient.listenerCount('message'),
      waUserClientCount: waUserClient.listenerCount('message'),
      waGatewayClientCount: waGatewayClient.listenerCount('message'),
    }),
    { debugOnly: true }
  );


  const clientsToInit = [
    { label: "WA", client: waClient },
    { label: "WA-USER", client: waUserClient },
    { label: "WA-GATEWAY", client: waGatewayClient },
  ];

  const initPromises = clientsToInit.map(({ label, client }) => {
    writeWaStructuredLog("info", buildWaStructuredLog({ clientId: client?.clientId || null, label, event: "startup" }));
    return client.initialize().catch((err) => {
      writeWaStructuredLog("error", buildWaStructuredLog({ clientId: client?.clientId || null, label, event: "fatal_init_error", errorCode: err?.code || "INIT_FAILED", errorMessage: err?.message || String(err) }));
    });
  });

  await Promise.allSettled(initPromises);

  const shouldFailFastOnInit =
    process.env.WA_EXPECT_MESSAGES === "true" ||
    process.env.NODE_ENV === "production";
  if (shouldFailFastOnInit) {
    const initIssues = clientsToInit
      .map((clientEntry) => getInitReadinessIssue(clientEntry))
      .filter(Boolean);
    if (initIssues.length > 0) {
      initIssues.forEach((issue) => {
        console.error(
          `[WA] ${issue.label} init issue: ${issue.reason}. Remediation: ${issue.remediation}`
        );
      });
      const summary = initIssues
        .map(
          (issue) => `${issue.label}:${issue.reason}${issue.detail ? ` (${issue.detail})` : ""}`
        )
        .join("; ");
      throw new Error(
        `[WA] WhatsApp clients not ready while expecting messages. ${summary}`
      );
    }
  }

  // Diagnostic checks to ensure message listeners are attached
  logWaServiceDiagnostics(
    waClient,
    waUserClient,
    waGatewayClient,
    getWaReadinessSummarySync()
  );
  checkMessageListenersAttached(waClient, waUserClient, waGatewayClient);
}

export default waClient;

// ======================= end of file ======================
