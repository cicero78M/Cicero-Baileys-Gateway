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
import {
  BULK_STATUS_HEADER_REGEX,
  processBulkDeletionRequest,
} from "../handler/wa/bulkDeletionHandler.js";

import { handleFetchKomentarTiktokBatch } from "../handler/fetchengagement/fetchCommentTiktok.js";

// >>> HANYA SATU INI <<< (Pastikan di helper semua diekspor)
import {
  userMenuContext,
  updateUsernameSession,
  userRequestLinkSessions,
  waBindSessions,
  operatorOptionSessions,
  adminOptionSessions,
  setSession,
  getSession,
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
const defaultGatewayClientId = "wa-gateway";
const rawGatewayClientId = String(env.GATEWAY_WA_CLIENT_ID || "");
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

ensureGatewayClientIdConsistency();

// Initialize WhatsApp client via Baileys (Gateway client only)
export let waClient = await createBaileysClient(resolvedGatewayClientId);

if (!normalizedGatewayClientId) {
  console.error(`[WA] GATEWAY_WA_CLIENT_ID kosong; clientId harus diset.`);
}
if (normalizedGatewayClientId === defaultGatewayClientId) {
  console.error(
    `[WA] GATEWAY_WA_CLIENT_ID masih default (${defaultGatewayClientId}); clientId harus unik.`
  );
}

const clientReadiness = new Map();
const adminNotificationQueue = [];
const readinessDiagnosticsIntervalMs = Math.max(
  30000,
  Number(process.env.WA_READINESS_DIAGNOSTIC_INTERVAL_MS) || 120000
);
const defaultReadyTimeoutMs = Number.isNaN(
  Number(process.env.WA_GATEWAY_READY_TIMEOUT_MS)
)
  ? 60000
  : Number(process.env.WA_GATEWAY_READY_TIMEOUT_MS);
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

function applyLifecycleTransition(client, label, eventName, reason, transitionHandler) {
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
          reason: reason ?? null,
          errorMessage: error?.message || String(error),
        })
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
    { key: "wa", client: waClient, label: "WA-GATEWAY" },
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

registerClientReadiness(waClient, "WA-GATEWAY");

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

/**
 * Wait for all WhatsApp client message queues to be idle (empty and no pending tasks)
 * This ensures all messages have been sent before the caller continues
 */
export async function waitForAllMessageQueues() {
  const clients = [waClient];
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
  // Now using single waClient (formerly waGatewayClient)
  return safeSendMessage(waClient, jid, text);
}

// Handle QR code (scan)
waClient.on("qr", (qr) => {
  const state = getClientReadinessState(waClient, "WA-GATEWAY");
  state.lastQrAt = Date.now();
  state.lastQrPayloadSeen = qr;
  state.awaitingQrScan = true;
  qrcode.generate(qr, { small: true });
  writeWaStructuredLog("debug", buildWaStructuredLog({ clientId: waClient?.clientId || null, label: "WA-GATEWAY", event: "qr" }), { debugOnly: true });
});

waClient.on("authenticated", (session) => {
  const sessionInfo = session ? "session received" : "no session payload";
  writeWaStructuredLog("debug", buildWaStructuredLog({ clientId: waClient?.clientId || null, label: "WA-GATEWAY", event: "authenticated", errorCode: sessionInfo }), { debugOnly: true });
  clearLogoutAwaitingQr(waClient);
});

waClient.on("auth_failure", (message) => {
  applyLifecycleTransition(
    waClient,
    "WA-GATEWAY",
    "auth_failure",
    message,
    () => {
      setClientNotReady(waClient);
      const state = getClientReadinessState(waClient, "WA-GATEWAY");
      state.lastAuthFailureAt = Date.now();
      state.lastAuthFailureMessage = message || null;
      writeWaStructuredLog("warn", buildWaStructuredLog({ clientId: waClient?.clientId || null, label: "WA-GATEWAY", event: "auth_failure", errorCode: "AUTH_FAILURE", errorMessage: message || null }));
    }
  );
});

waClient.on("disconnected", (reason) => {
  applyLifecycleTransition(waClient, "WA-GATEWAY", "disconnected", reason, () => {
    const normalizedReason = normalizeDisconnectReason(reason);
    const state = getClientReadinessState(waClient, "WA-GATEWAY");
    state.lastDisconnectReason = normalizedReason || null;
    state.awaitingQrScan = isLogoutDisconnectReason(normalizedReason);
    setClientNotReady(waClient);
    writeWaStructuredLog("warn", buildWaStructuredLog({ clientId: waClient?.clientId || null, label: "WA-GATEWAY", event: "disconnected", errorCode: normalizedReason || null }));
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
    `unknown-state:WA-GATEWAY:${normalizedState || 'empty'}`,
    buildWaStructuredLog({
      clientId: waClient?.clientId || null,
      label: "WA-GATEWAY",
      event: "change_state_unknown",
      errorCode: normalizedState || "UNKNOWN_STATE",
    })
  );
});

// =======================
// MESSAGE HANDLER UTAMA
// =======================
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
      const normalizedText = text.trim().toLowerCase();
      const session = getSession(chatId);

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
        waClient,
        pool,
        userModel,
      });
      if (handledComplaint) {
        return;
      }

      const isBulkSession =
        session?.menu === "clientrequest" &&
        ["bulkStatus_process", "bulkStatus_selectRole"].includes(session?.step);
      if (BULK_STATUS_HEADER_REGEX.test(normalizedText) || isBulkSession) {
        const bulkSession = getSession(chatId);
        if (!bulkSession) {
          setSession(chatId, { menu: "clientrequest", step: "bulkStatus_process" });
        }
        await processBulkDeletionRequest({
          session: bulkSession || getSession(chatId),
          chatId,
          text,
          waClient,
          userModel,
        });
        return;
      }

      console.log(
        `${clientLabel} Ignored non-relevant private message from ${chatId}`
      );
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
    waClient: waClient,
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
  const readinessState = getClientReadinessState(waClient, "WA-GATEWAY");
  if (!readinessState.ready) {
    waClient
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
  const isAdmin = isAdminWhatsApp(senderId);
  const initialIsMyContact =
    typeof msg.isMyContact === "boolean" ? msg.isMyContact : null;
  const session = getSession(chatId);

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
    waClient: waClient,
    pool,
    userModel,
  });
  if (handledComplaint) {
    return;
  }

  const isBulkSession =
    session?.menu === "clientrequest" &&
    ["bulkStatus_process", "bulkStatus_selectRole"].includes(session?.step);
  if (BULK_STATUS_HEADER_REGEX.test(normalizedText) || isBulkSession) {
    await processGatewayBulkDeletion(chatId, text);
    return;
  }

  console.log(
    `[WA-GATEWAY] Ignored non-relevant message from ${chatId}`
  );
}

registerClientMessageHandler(waClient, "wwebjs-gateway", handleGatewayMessage);

if (shouldInitWhatsAppClients) {
  startReadinessDiagnosticsLogger();
  writeWaStructuredLog("info", buildWaStructuredLog({ label: "WA-GATEWAY", event: "wa_message_listener_attach_start" }));
  
  waClient.on('message', (msg) => {
    writeWaStructuredLog(
      "debug",
      buildWaStructuredLog({
        clientId: waClient?.clientId || null,
        label: "WA-GATEWAY",
        event: "message_received",
        jid: msg?.from || null,
        messageId: msg?.id?._serialized || msg?.id?.id || null,
      }),
      { debugOnly: true }
    );
    handleIncoming('baileys-gateway', msg, handleGatewayMessage);
  });

  writeWaStructuredLog("info", buildWaStructuredLog({ label: "WA-GATEWAY", event: "wa_message_listener_attach_ready" }));
  writeWaStructuredLog(
    "debug",
    buildWaStructuredLog({
      label: "WA-GATEWAY",
      event: "wa_message_listener_count",
      waClientCount: waClient.listenerCount('message'),
    }),
    { debugOnly: true }
  );


  const clientsToInit = [
    { label: "WA-GATEWAY", client: waClient },
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
    null,
    null,
    getWaReadinessSummarySync()
  );
  checkMessageListenersAttached(waClient, null, null);
}

export default waClient;

// ======================= end of file ======================
