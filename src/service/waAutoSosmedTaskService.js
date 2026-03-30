import { fetchSinglePostKhusus } from '../handler/fetchpost/instaFetchPost.js';
import { fetchAndStoreSingleTiktokPost } from '../handler/fetchpost/tiktokFetchPost.js';
import { query } from '../db/postgres.js';
import { enqueueSend } from './waOutbox.js';
import { logger } from '../utils/logger.js';
import { isBroadcastMessage, extractUrls, formatDate } from './sosmedBroadcastParser.js';
import { getConfigOrDefault } from './clientConfigService.js';
import {
  findActiveSession,
  upsertSession,
  deleteSession,
} from '../repository/operatorRegistrationSessionRepository.js';
import { findActiveOperatorByPhone } from '../repository/operatorRepository.js';
import {
  handleUnregisteredBroadcast,
  handleRegistrationDialog,
} from './operatorRegistrationService.js';
import { getCommentsByVideoId } from '../model/tiktokCommentModel.js';
import { getUsersByClientFull } from '../model/userModel.js';

// Pool proxy for repositories
const _pool = { query: (sql, params) => query(sql, params) };

const MANUAL_INPUT_STAGE = 'manual_input_sosmed';
const REGISTRATION_STAGES = new Set(['awaiting_confirmation', 'awaiting_satker_choice']);
const MANUAL_INPUT_START_COMMANDS = new Set([
  'input manual ig/tiktok',
  'input manual ig tiktok',
  'manual ig/tiktok',
  'manual ig tiktok',
]);
const MANUAL_INPUT_EXIT_COMMANDS = new Set(['batal', 'menu']);

// FR-021: In-memory operator broadcast rate limit counter
// Map<phoneNumber, { count, windowStart }> — bounded by O(active operators)
const _operatorRateLimit = new Map();

function isOperatorRateLimited(phoneNumber, limitPerHour) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const entry = _operatorRateLimit.get(phoneNumber);
  if (!entry || now - entry.windowStart >= windowMs) {
    _operatorRateLimit.set(phoneNumber, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= limitPerHour) return true;
  entry.count += 1;
  return false;
}

function normalizeCommandToken(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isManualInputStartCommand(text) {
  const token = normalizeCommandToken(text);
  return MANUAL_INPUT_START_COMMANDS.has(token);
}

function isManualInputExitCommand(text) {
  const token = normalizeCommandToken(text);
  return MANUAL_INPUT_EXIT_COMMANDS.has(token);
}

function isRegistrationStage(stage) {
  return REGISTRATION_STAGES.has(String(stage || '').toLowerCase());
}

function isManualInputStage(stage) {
  return String(stage || '').toLowerCase() === MANUAL_INPUT_STAGE;
}

function extractAllHttpUrls(text) {
  if (!text || typeof text !== 'string') return [];
  return Array.from(new Set((text.match(/https?:\/\/[^\s)>]+/gi) || []).map((u) => u.trim())));
}

async function activateManualInputSession(phoneNumber) {
  const ttlSeconds = 60 * 60;
  const cooldownMinutes = 60;
  await upsertSession(
    _pool,
    phoneNumber,
    MANUAL_INPUT_STAGE,
    JSON.stringify({ mode: MANUAL_INPUT_STAGE, activatedAt: new Date().toISOString() }),
    ttlSeconds,
    cooldownMinutes
  );
}

async function deactivateManualInputSession(phoneNumber) {
  await deleteSession(_pool, phoneNumber);
}

// Evict stale rate-limit entries to prevent unbounded Map growth (constitution §VII)
const _operatorRateLimitEvictionHandle = setInterval(() => {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  for (const [k, v] of _operatorRateLimit) {
    if (now - v.windowStart >= windowMs) _operatorRateLimit.delete(k);
  }
}, 60 * 60 * 1000);

if (_operatorRateLimitEvictionHandle.unref) {
  _operatorRateLimitEvictionHandle.unref();
}

export function clearOperatorRateLimit() {
  _operatorRateLimit.clear();
}

export function stopOperatorRateLimitEviction() {
  clearInterval(_operatorRateLimitEvictionHandle);
}

// Utility: timeout wrapper
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ]);
}

// Backward-compat text helper (kept for external callers)
export function cleanText(text) {
  return String(text || '')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\u2060|\u200b|\u200c|\u200d/g, '');
}

// DB helpers

async function recordSuccessfulTasksToDB({ igResults, tiktokResults, clientId, operatorPhone }) {
  const opArr = [];

  for (const item of igResults) {
    if (!item?.ok || !item?.data?.shortcode) continue;
    const shortcode = String(item.data.shortcode).trim();
    if (!shortcode) continue;
    opArr.push(
      query(
        `INSERT INTO insta_post (client_id, shortcode, source_type, task_source, operator_phone, created_at)
         VALUES ($1, $2, 'manual_input', 'broadcast_wa', $3, NOW())
         ON CONFLICT (shortcode) DO UPDATE
           SET client_id      = EXCLUDED.client_id,
               source_type    = 'manual_input',
               task_source    = 'broadcast_wa',
               operator_phone = COALESCE(EXCLUDED.operator_phone, insta_post.operator_phone)`,
        [clientId, shortcode, operatorPhone ?? null]
      )
    );
  }

  for (const item of tiktokResults) {
    if (!item?.ok || !item?.data?.videoId) continue;
    const videoId = String(item.data.videoId).trim();
    if (!videoId) continue;
    opArr.push(
      query(
        `INSERT INTO tiktok_post (client_id, video_id, source_type, task_source, operator_phone, created_at)
         VALUES ($1, $2, 'manual_input', 'broadcast_wa', $3, NOW())
         ON CONFLICT (video_id) DO UPDATE
           SET client_id      = EXCLUDED.client_id,
               source_type    = 'manual_input',
               task_source    = 'broadcast_wa',
               operator_phone = COALESCE(EXCLUDED.operator_phone, tiktok_post.operator_phone)`,
        [clientId, videoId, operatorPhone ?? null]
      )
    );
  }

  await Promise.allSettled(opArr);
}

async function fetchInstagramPosts(igUrls, clientId, onProgress = null) {
  const igResults = [];
  for (let index = 0; index < igUrls.length; index += 1) {
    const url = igUrls[index];
    try {
      const data = await withTimeout(fetchSinglePostKhusus(url, clientId), 8000);
      igResults.push({ url, ok: true, data });
      if (onProgress) await onProgress({ platform: 'instagram', index: index + 1, total: igUrls.length, url, ok: true });
    } catch {
      igResults.push({ url, ok: false, data: null });
      if (onProgress) await onProgress({ platform: 'instagram', index: index + 1, total: igUrls.length, url, ok: false });
    }
  }
  return igResults;
}

async function fetchTiktokPosts(tiktokUrls, clientId, onProgress = null) {
  const tiktokResults = [];
  for (let index = 0; index < tiktokUrls.length; index += 1) {
    const url = tiktokUrls[index];
    try {
      const data = await withTimeout(fetchAndStoreSingleTiktokPost(clientId, url), 8000);
      tiktokResults.push({ url, ok: true, data });
      if (onProgress) await onProgress({ platform: 'tiktok', index: index + 1, total: tiktokUrls.length, url, ok: true });
    } catch {
      tiktokResults.push({ url, ok: false, data: null });
      if (onProgress) await onProgress({ platform: 'tiktok', index: index + 1, total: tiktokUrls.length, url, ok: false });
    }
  }
  return tiktokResults;
}

async function fetchEngagementFromFetchedPosts(igResults, tiktokResults, clientId) {
  const { handleFetchLikesInstagram } = await import('../handler/fetchengagement/fetchLikesInstagram.js');
  const { handleFetchKomentarTiktokBatch } = await import('../handler/fetchengagement/fetchCommentTiktok.js');

  const fetchedShortcodes = igResults
    .filter(({ ok, data }) => ok && data?.shortcode)
    .map(({ data }) => String(data.shortcode).trim())
    .filter(Boolean);

  if (fetchedShortcodes.length) {
    try {
      await handleFetchLikesInstagram(null, null, clientId, {
        shortcodes: fetchedShortcodes,
        sourceType: 'manual_input',
        enrichComments: false,
      });
    } catch (err) {
      logger.warn({ err, clientId }, 'waAutoSosmedTask: IG engagement sync failed');
    }
  }

  const fetchedVideoIds = tiktokResults
    .filter(({ ok, data }) => ok && data?.videoId)
    .map(({ data }) => data.videoId);
  if (fetchedVideoIds.length) {
    try {
      await handleFetchKomentarTiktokBatch(null, null, clientId, {
        sourceType: 'manual_input',
        videoIds: fetchedVideoIds,
      });
    } catch (err) {
      logger.warn({ err, clientId }, 'waAutoSosmedTask: TikTok engagement sync failed');
    }
  }
}

async function getTodayOperatorTaskList(clientId, operatorPhone) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const [igRes, tikRes] = await Promise.all([
    query(
      `SELECT shortcode FROM insta_post
       WHERE LOWER(client_id) = LOWER($1) AND operator_phone = $2 AND task_source = 'broadcast_wa'
         AND (created_at AT TIME ZONE 'Asia/Jakarta')::date = $3::date
       ORDER BY created_at ASC`,
      [clientId, operatorPhone, today]
    ),
    query(
      `SELECT video_id FROM tiktok_post
       WHERE LOWER(client_id) = LOWER($1) AND operator_phone = $2 AND task_source = 'broadcast_wa'
         AND (created_at AT TIME ZONE 'Asia/Jakarta')::date = $3::date
       ORDER BY created_at ASC`,
      [clientId, operatorPhone, today]
    ),
  ]);
  return {
    igShortcodes: igRes.rows.map((r) => r.shortcode),
    tiktokVideoIds: tikRes.rows.map((r) => r.video_id),
  };
}

function buildTaskListText(igShortcodes, tiktokVideoIds, formattedDate) {
  const parts = [`Daftar tugas sosmed Anda hari ini (${formattedDate}):` ];
  if (igShortcodes.length) {
    parts.push(`Instagram (${igShortcodes.length} konten):\n${igShortcodes.map((s) => `  - ${s}`).join('\n')}`);
  }
  if (tiktokVideoIds.length) {
    parts.push(`TikTok (${tiktokVideoIds.length} konten):\n${tiktokVideoIds.map((v) => `  - ${v}`).join('\n')}`);
  }
  if (!igShortcodes.length && !tiktokVideoIds.length) {
    parts.push('(belum ada tugas yang direkam hari ini)');
  }
  return parts.join('\n\n');
}

async function sendPostInputMessages({ clientId, phoneNumber, dmJid, formattedDate, logContext }) {
  const ackTemplate = await getConfigOrDefault(
    clientId,
    'task_input_ack',
    'Tugas dari broadcast Anda telah diinputkan untuk klien {client_id}.'
  );
  await enqueueSend(dmJid, { text: ackTemplate.replace('{client_id}', clientId) });

  try {
    const { igShortcodes, tiktokVideoIds } = await getTodayOperatorTaskList(clientId, phoneNumber);
    await enqueueSend(dmJid, { text: buildTaskListText(igShortcodes, tiktokVideoIds, formattedDate) });
  } catch (err) {
    logger.error({ err, phoneNumber, clientId }, logContext);
  }
}

function buildProcessingSummaryText({
  igResults,
  tiktokResults,
  ignoredNonPlatformCount,
}) {
  const igFailedItems = igResults.filter((item) => !item.ok);
  const tiktokFailedItems = tiktokResults.filter((item) => !item.ok);

  const summaryLines = [
    '✅ Proses input manual multi-link selesai.',
    `• Instagram berhasil: ${igResults.length - igFailedItems.length}`,
    `• TikTok berhasil: ${tiktokResults.length - tiktokFailedItems.length}`,
    `• Total gagal: ${igFailedItems.length + tiktokFailedItems.length}`,
    `• Link non-IG/TikTok diabaikan: ${Math.max(0, ignoredNonPlatformCount)}`,
  ];

  return {
    summaryText: summaryLines.join('\n'),
    igFailedItems,
    tiktokFailedItems,
  };
}

async function sendUnifiedFinalMessages({
  clientId,
  phoneNumber,
  dmJid,
  igResults,
  tiktokResults,
  ignoredNonPlatformCount,
  formattedDate,
  logContext,
}) {
  const {
    summaryText,
    igFailedItems,
    tiktokFailedItems,
  } = buildProcessingSummaryText({
    igResults,
    tiktokResults,
    ignoredNonPlatformCount,
  });

  await enqueueSend(dmJid, { text: summaryText });

  if (igFailedItems.length || tiktokFailedItems.length) {
    const failedLines = [
      '⚠️ Sebagian link gagal diproses:',
      ...igFailedItems.map((item) => `- ${item.url}`),
      ...tiktokFailedItems.map((item) => `- ${item.url}`),
    ];
    await enqueueSend(dmJid, { text: failedLines.join('\n') });
  }

  await sendPostInputMessages({
    clientId,
    phoneNumber,
    dmJid,
    formattedDate,
    logContext,
  });
}

function normalizeHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function formatPersonnelName(user) {
  const title = String(user?.title || '').trim();
  const name = String(user?.nama || '-').trim();
  if (title) return `${title} ${name}`;
  return name;
}

function formatPersonnelList(users) {
  if (!users.length) return '-';
  return users.map((u) => `- ${formatPersonnelName(u)} (${u.tiktok || '-'})`).join('\n');
}

async function buildTiktokMenu8Summary(clientId, tiktokResults) {
  const successfulTikTok = tiktokResults.filter((item) => item.ok && item.data?.videoId);
  if (!successfulTikTok.length) return null;

  const uniqueCommenters = new Set();
  for (const item of successfulTikTok) {
    const videoId = String(item.data.videoId || '').trim();
    if (!videoId) continue;
    const commentPayload = await getCommentsByVideoId(videoId).catch(() => ({ comments: [] }));
    const commenters = Array.isArray(commentPayload?.comments) ? commentPayload.comments : [];
    commenters
      .map((uname) => normalizeHandle(uname))
      .filter(Boolean)
      .forEach((uname) => uniqueCommenters.add(uname));
  }

  const roleFilter = String(clientId || '').toLowerCase();
  const users = await getUsersByClientFull(clientId, roleFilter).catch(() => []);
  const activeUsers = Array.isArray(users) ? users : [];

  const melaksanakan = [];
  const belumMelaksanakan = [];
  const belumIsiUsername = [];

  for (const user of activeUsers) {
    const normalized = normalizeHandle(user?.tiktok);
    if (!normalized) {
      belumIsiUsername.push(user);
      continue;
    }
    if (user?.exception === true || uniqueCommenters.has(normalized)) {
      melaksanakan.push(user);
    } else {
      belumMelaksanakan.push(user);
    }
  }

  return (
    `🎵 *TikTok (Workflow Chakranarayana Menu 8)*\n` +
    `*Jumlah Konten:* ${successfulTikTok.length}\n` +
    `*Jumlah Total Personil:* ${activeUsers.length} pers\n` +
    `✅ *Melaksanakan:* ${melaksanakan.length} pers\n` +
    `❌ *Belum melaksanakan:* ${belumMelaksanakan.length} pers\n` +
    `⚠️❌ *Belum Input Username TikTok:* ${belumIsiUsername.length} pers\n\n` +
    `✅ *Daftar Melaksanakan*\n${formatPersonnelList(melaksanakan)}\n\n` +
    `❌ *Daftar Belum Melaksanakan*\n${formatPersonnelList(belumMelaksanakan)}\n\n` +
    `⚠️❌ *Belum Input Username TikTok*\n${formatPersonnelList(belumIsiUsername)}`
  );
}

async function buildEngagementRecapText(igResults, tiktokResults, formattedDate, clientId) {
  const successfulIg = igResults.filter((item) => item?.ok && item?.data);
  const successfulTikTok = tiktokResults.filter((item) => item?.ok && item?.data);

  const getWibDateTime = (value) => {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
      hour12: false,
    }).format(date).replace(':', '.') + ' WIB';
  };

  const getWibSnapshotTime = () => {
    const now = new Date();
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
      hour12: false,
    }).format(now).replace(':', '.') + ' WIB';
  };

  const cropCaption = (caption) => {
    const raw = String(caption || '').trim();
    if (!raw) return '-';
    if (raw.length <= 70) return raw;
    return `${raw.slice(0, 67)}...`;
  };

  const igDetails = successfulIg.map(({ url, data }, idx) => {
    const uploadTime = getWibDateTime(
      data?.post_date ||
      data?.taken_at ||
      data?.taken_at_timestamp ||
      data?.uploaded_at ||
      data?.created_at
    );
    const likes = data?.like_count ?? data?.likeCount ?? 0;
    const comments = data?.comment_count ?? data?.commentCount ?? 0;
    const caption = cropCaption(data?.caption);
    return (
      `${idx + 1}. ${url}\n` +
      `   _${caption}_\n` +
      `   Upload: ${uploadTime}\n` +
      `   Likes: ${likes} | Komentar: ${comments}`
    );
  });

  const tiktokDetails = successfulTikTok.map(({ url, data }, idx) => {
    const uploadTime = getWibDateTime(
      data?.createTime ||
      data?.create_time ||
      data?.posted_at ||
      data?.created_at ||
      data?.createdAt
    );
    const likes = data?.like_count ?? data?.likeCount ?? 0;
    const comments = data?.comment_count ?? data?.commentCount ?? 0;
    const caption = cropCaption(data?.caption || data?.desc);
    return (
      `${idx + 1}. ${url}\n` +
      `   _${caption}_\n` +
      `   Upload: ${uploadTime}\n` +
      `   Likes: ${likes} | Komentar: ${comments}`
    );
  });

  const sections = [
    '📋 *Daftar Tugas - DIREKTORAT INTELKAM*',
    `🕒 Pengambilan data: ${getWibSnapshotTime()}`,
    '',
    'Status tugas saat ini:',
    `📸 Instagram: *${successfulIg.length}* konten`,
    `🎵 TikTok: *${successfulTikTok.length}* konten`,
    '',
    '📝 *Detail Tugas:*',
  ];

  if (successfulIg.length) {
    sections.push('', `📸 *Tugas Instagram (${successfulIg.length} konten):*`, '', igDetails.join('\n\n'));
  }

  if (successfulTikTok.length) {
    sections.push('', `🎵 *Tugas TikTok (${successfulTikTok.length} konten):*`, '', tiktokDetails.join('\n\n'));
  }

  sections.push('', '_Pastikan semua tugas telah dikerjakan dengan baik._');
  return sections.join('\n').trim();
}

async function loadBroadcastConfig(clientId) {
  const [trigger, phrase, action] = await Promise.all([
    getConfigOrDefault(clientId, 'broadcast_trigger_keywords', 'pagi,siang,sore,malam'),
    getConfigOrDefault(clientId, 'broadcast_required_phrase', 'mohon izin dibantu'),
    getConfigOrDefault(clientId, 'broadcast_action_keywords', 'like,comment,share,follow,subscribe,repost'),
  ]);
  return {
    broadcast_trigger_keywords: trigger,
    broadcast_required_phrase: phrase,
    broadcast_action_keywords: action,
  };
}

export async function handleAutoSosmedTaskMessageIfApplicable({ text, chatId, senderPhone, messageKey, waClient }) {
  // Kontrak urutan response final operator (manual session & operator biasa):
  // 1) start
  // 2) progress (jika mode mengirim progress)
  // 3) summary selesai
  // 4) fail list (jika ada)
  // 5) ACK
  // 6) list tugas hari ini
  // FR-010: always ignore status@broadcast
  if (chatId === 'status@broadcast') return false;

  // FR-009: mark message as seen before processing
  if (messageKey) {
    try {
      await waClient.readMessages([messageKey]);
      await new Promise((r) => setTimeout(r, 1000));
    } catch {
      // non-fatal
    }
  }

  const isGroup = chatId.endsWith('@g.us');

  logger.info({ senderPhone, chatId, isGroup }, 'waAutoSosmedTask: handler entry');

  // GROUP PATH
  if (isGroup) {
    logger.info({ chatId, senderPhone }, 'waAutoSosmedTask: group message skipped for auto sosmed task feature');
    return false;
  }

  // DM PATH

  // Filter: newsletter channels are not real 1:1 senders (FR-010 extension)
  if (chatId.endsWith('@newsletter')) return false;

  // Normalise senderPhone to digits-only for DB lookups.
  // Baileys may deliver messages with @lid or @s.whatsapp.net suffixes; strip them.
  const phoneNumber = senderPhone.replace(/@[^@]+$/, '');

  // Reply to the actual incoming chat JID, never to a reconstructed @s.whatsapp.net
  // (wrong for @lid senders which would produce "xxx@lid@s.whatsapp.net").
  const dmJid = chatId;

  // Active session check
  const session = await findActiveSession(_pool, phoneNumber);
  if (session && isRegistrationStage(session.stage)) {
    await handleRegistrationDialog(phoneNumber, text, enqueueSend, async (originalMessage) => {
      await handleAutoSosmedTaskMessageIfApplicable({
        text: originalMessage,
        chatId: dmJid,
        senderPhone: phoneNumber,
        messageKey: null,
        waClient,
      });
    }, dmJid);
    return true;
  }

  if (session && isManualInputStage(session.stage)) {
    const operatorInSession = await findActiveOperatorByPhone(_pool, phoneNumber);
    if (!operatorInSession) {
      await deactivateManualInputSession(phoneNumber);
      return false;
    }

    if (isManualInputExitCommand(text)) {
      await deactivateManualInputSession(phoneNumber);
      await enqueueSend(dmJid, {
        text: 'Mode input manual IG/TikTok ditutup. Silakan gunakan menu utama.',
      });
      return true;
    }

    const clientId = operatorInSession.client_id;
    const rateLimitStr = await getConfigOrDefault(clientId, 'operator_broadcast_rate_limit', '20');
    const rateLimit = parseInt(rateLimitStr, 10);
    if (isOperatorRateLimited(phoneNumber, rateLimit)) {
      logger.warn({ phoneNumber, clientId }, 'waAutoSosmedTask: manual input rate limit exceeded, suppressing');
      return true;
    }

    const allUrls = extractAllHttpUrls(text);
    let { igUrls, tiktokUrls } = extractUrls(text);
    const ignoredNonPlatformCount = allUrls.length - (igUrls.length + tiktokUrls.length);
    const totalUrls = igUrls.length + tiktokUrls.length;
    if (totalUrls > 10) {
      const allCapped = [...igUrls, ...tiktokUrls].slice(0, 10);
      igUrls = allCapped.filter((u) => /instagram\.com|ig\.me/i.test(u));
      tiktokUrls = allCapped.filter((u) => /tiktok\.com/i.test(u));
    }

    if (igUrls.length + tiktokUrls.length === 0) {
      await enqueueSend(dmJid, {
        text: 'Mode input manual aktif. Kirim link Instagram/TikTok atau ketik *batal/menu* untuk keluar.',
      });
      return true;
    }

    const formattedDate = formatDate(new Date());
    await enqueueSend(dmJid, {
      text:
        `Proses input manual multi-link dimulai.\n` +
        `1) Fetch post Instagram & TikTok\n` +
        `2) Fetch likes Instagram & komentar TikTok\n` +
        `3) Informasi input manual\n` +
        `4) List tugas hari ini\n\n` +
        `Target Instagram: ${igUrls.length}\n` +
        `Target TikTok: ${tiktokUrls.length}`,
    });

    const igResults = await fetchInstagramPosts(igUrls, clientId, async ({ platform, index, total, url, ok }) => {
      const platformLabel = platform === 'instagram' ? 'Instagram' : 'TikTok';
      const statusLabel = ok ? 'sukses' : 'gagal';
      await enqueueSend(dmJid, {
        text: `Progress ${platformLabel} ${index}/${total}: ${statusLabel}\n${url}`,
      });
    });
    const tiktokResults = await fetchTiktokPosts(tiktokUrls, clientId, async ({ platform, index, total, url, ok }) => {
      const platformLabel = platform === 'instagram' ? 'Instagram' : 'TikTok';
      const statusLabel = ok ? 'sukses' : 'gagal';
      await enqueueSend(dmJid, {
        text: `Progress ${platformLabel} ${index}/${total}: ${statusLabel}\n${url}`,
      });
    });
    await fetchEngagementFromFetchedPosts(igResults, tiktokResults, clientId);
    try {
      await recordSuccessfulTasksToDB({ igResults, tiktokResults, clientId, operatorPhone: phoneNumber });
    } catch (err) {
      logger.error({ err, phoneNumber, clientId }, 'waAutoSosmedTask: manual mode DB upsert success tasks failed');
    }

    await sendUnifiedFinalMessages({
      clientId,
      phoneNumber,
      dmJid,
      igResults,
      tiktokResults,
      ignoredNonPlatformCount,
      formattedDate,
      logContext: 'waAutoSosmedTask: manual mode failed to fetch today task list',
    });

    const recapText = await buildEngagementRecapText(igResults, tiktokResults, formattedDate, clientId);
    await enqueueSend(dmJid, { text: recapText });
    return true;
  }

  // Registered operator path
  const operator = await findActiveOperatorByPhone(_pool, phoneNumber);
  if (operator) {
    const clientId = operator.client_id;

    if (isManualInputStartCommand(text)) {
      await activateManualInputSession(phoneNumber);
      await enqueueSend(dmJid, {
        text: 'Mode input manual IG/TikTok aktif. Kirim satu atau banyak link Instagram/TikTok. Ketik *batal* atau *menu* untuk keluar.',
      });
      return true;
    }

    const config = await loadBroadcastConfig(clientId);
    if (!isBroadcastMessage(text, config)) {
      return false;
    }

    // Delta 5 (FR-021): per-operator broadcast rate limit
    const rateLimitStr = await getConfigOrDefault(clientId, 'operator_broadcast_rate_limit', '20');
    const rateLimit = parseInt(rateLimitStr, 10);
    if (isOperatorRateLimited(phoneNumber, rateLimit)) {
      logger.warn({ phoneNumber, clientId }, 'waAutoSosmedTask: operator broadcast rate limit exceeded, suppressing');
      return true;
    }

    // Delta 1 (FR-005.1): URL cap at max 10 per broadcast
    let { igUrls, tiktokUrls } = extractUrls(text);
    const totalUrls = igUrls.length + tiktokUrls.length;
    if (totalUrls > 10) {
      logger.warn({ phoneNumber, clientId, total: totalUrls }, 'waAutoSosmedTask: URL cap applied, URLs beyond 10 ignored');
      const allCapped = [...igUrls, ...tiktokUrls].slice(0, 10);
      igUrls = allCapped.filter((u) => /instagram\.com|ig\.me/i.test(u));
      tiktokUrls = allCapped.filter((u) => /tiktok\.com/i.test(u));
    }

    // Delta 3 (FR-006b): zero valid platform URLs → single error reply, no 3-part response
    if (igUrls.length + tiktokUrls.length === 0) {
      const noUrlMsg = await getConfigOrDefault(
        clientId, 'operator_no_valid_url',
        'Tidak ditemukan URL Instagram atau TikTok dalam pesan Anda.');
      await enqueueSend(dmJid, { text: noUrlMsg });
      return true;
    }

    const allHttpUrls = extractAllHttpUrls(text);
    const ignoredNonPlatformCount = Math.max(0, allHttpUrls.length - (igUrls.length + tiktokUrls.length));

    logger.info({ phoneNumber, clientId, igUrls, tiktokUrls, ignoredNonPlatformCount }, 'waAutoSosmedTask: DM registered operator');

    await enqueueSend(dmJid, { text: '⏳ Proses input manual multi-link dimulai.' });

    const igResults = await fetchInstagramPosts(igUrls, clientId);
    const tiktokResults = await fetchTiktokPosts(tiktokUrls, clientId);
    await fetchEngagementFromFetchedPosts(igResults, tiktokResults, clientId);
    try {
      await recordSuccessfulTasksToDB({ igResults, tiktokResults, clientId, operatorPhone: phoneNumber });
    } catch (err) {
      logger.error({ err, phoneNumber, clientId }, 'waAutoSosmedTask: DM DB upsert success tasks failed');
    }

    await sendUnifiedFinalMessages({
      clientId,
      phoneNumber,
      dmJid,
      igResults,
      tiktokResults,
      ignoredNonPlatformCount,
      formattedDate: formatDate(new Date()),
      logContext: 'waAutoSosmedTask: DM mode failed to fetch today task list',
    });

    return true;
  }

  // Unregistered number path
  const defaultConfig = await loadBroadcastConfig('DEFAULT');
  if (!isBroadcastMessage(text, defaultConfig)) {
    return false;
  }

  logger.info({ phoneNumber }, 'waAutoSosmedTask: DM unregistered with broadcast format');
  await handleUnregisteredBroadcast(phoneNumber, text, enqueueSend, dmJid);
  return true;
}
