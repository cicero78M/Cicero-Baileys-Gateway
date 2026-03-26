import { fetchSinglePostKhusus } from '../handler/fetchpost/instaFetchPost.js';
import { fetchAndStoreSingleTiktokPost } from '../handler/fetchpost/tiktokFetchPost.js';
import { query } from '../db/postgres.js';
import { enqueueSend } from './waOutbox.js';
import { logger } from '../utils/logger.js';
import { isBroadcastMessage, extractUrls, formatDate } from './sosmedBroadcastParser.js';
import { resolveClientIdForGroup, getConfigOrDefault } from './clientConfigService.js';
import { findActiveSession } from '../repository/operatorRegistrationSessionRepository.js';
import { findActiveOperatorByPhone } from '../repository/operatorRepository.js';
import {
  handleUnregisteredBroadcast,
  handleRegistrationDialog,
} from './operatorRegistrationService.js';

// Pool proxy for repositories
const _pool = { query: (sql, params) => query(sql, params) };

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

async function recordTasksToDB(igUrls, tiktokUrls, clientId, operatorPhone) {
  const opArr = [];

  for (const url of igUrls) {
    const match = url.match(/(?:instagram\.com\/(?:p|reel|tv)\/|ig\.me\/p\/)([A-Za-z0-9_-]+)/i);
    const shortcode = match?.[1] ?? url;
    opArr.push(
      query(
        `INSERT INTO insta_post (client_id, shortcode, task_source, operator_phone, created_at)
         VALUES ($1, $2, 'broadcast_wa', $3, NOW())
         ON CONFLICT (shortcode) DO NOTHING`,
        [clientId, shortcode, operatorPhone ?? null]
      )
    );
  }

  for (const url of tiktokUrls) {
    const match = url.match(/video\/(\d+)/i);
    const videoId = match?.[1] ?? url;
    opArr.push(
      query(
        `INSERT INTO tiktok_post (client_id, video_id, task_source, operator_phone, created_at)
         VALUES ($1, $2, 'broadcast_wa', $3, NOW())
         ON CONFLICT (video_id) DO NOTHING`,
        [clientId, videoId, operatorPhone ?? null]
      )
    );
  }

  await Promise.allSettled(opArr);
}

async function liveFetchAll(igUrls, tiktokUrls, clientId) {
  const igPromises = igUrls.map((url) =>
    withTimeout(fetchSinglePostKhusus(url, clientId), 8000)
      .then((data) => ({ url, ok: true, data }))
      .catch(() => ({ url, ok: false, data: null }))
  );

  const tiktokPromises = tiktokUrls.map((url) =>
    withTimeout(fetchAndStoreSingleTiktokPost(clientId, url), 8000)
      .then((data) => ({ url, ok: true, data }))
      .catch(() => ({ url, ok: false, data: null }))
  );

  const [igSettled, tiktokSettled] = await Promise.all([
    Promise.allSettled(igPromises),
    Promise.allSettled(tiktokPromises),
  ]);

  return {
    igResults: igSettled.map((r) => (r.status === 'fulfilled' ? r.value : { url: '', ok: false, data: null })),
    tiktokResults: tiktokSettled.map((r) => (r.status === 'fulfilled' ? r.value : { url: '', ok: false, data: null })),
  };
}

function buildEngagementRecapText(igResults, tiktokResults, formattedDate) {
  const igLines = igResults.map(({ url, ok, data }) => {
    if (!ok || !data) return `  - ${url} - data tidak tersedia`;
    return `  - ${url} - ${data.like_count ?? '-'} likes`;
  });

  const tiktokLines = tiktokResults.map(({ url, ok, data }) => {
    if (!ok || !data) return `  - ${url} - data tidak tersedia`;
    return `  - ${url} - ${data.comment_count ?? '-'} komentar`;
  });

  const parts = [`Rekap engagement tugas ${formattedDate}:`];
  if (igLines.length) parts.push(`Instagram (${igLines.length} konten):\n${igLines.join('\n')}`);
  if (tiktokLines.length) parts.push(`TikTok (${tiktokLines.length} konten):\n${tiktokLines.join('\n')}`);

  return parts.join('\n\n');
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
    const clientId = await resolveClientIdForGroup(chatId);
    if (!clientId) {
      logger.warn({ chatId }, 'waAutoSosmedTask: group JID has no registered client_id');
      return false;
    }

    const config = await loadBroadcastConfig(clientId);
    if (!isBroadcastMessage(text, config)) {
      return false;
    }

    const { igUrls, tiktokUrls } = extractUrls(text);
    const urlCount = igUrls.length + tiktokUrls.length;

    logger.info({ clientId, chatId, igUrls, tiktokUrls }, 'waAutoSosmedTask: group broadcast detected');

    try {
      await recordTasksToDB(igUrls, tiktokUrls, clientId, null);
    } catch (err) {
      logger.error({ err, clientId, chatId }, 'waAutoSosmedTask: DB insert failed');
    }

    const formattedDate = formatDate(new Date());
    const ackText = `Ack! Tugas broadcast sosmed ${formattedDate} berhasil direkam. ${urlCount} URL telah dicatat.`;
    await enqueueSend(chatId, { text: ackText });

    return true;
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

  // Active registration session check
  const session = await findActiveSession(_pool, phoneNumber);
  if (session) {
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

  // Registered operator path
  const operator = await findActiveOperatorByPhone(_pool, phoneNumber);
  if (operator) {
    const clientId = operator.client_id;
    const config = await loadBroadcastConfig(clientId);
    if (!isBroadcastMessage(text, config)) {
      return false;
    }

    const { igUrls, tiktokUrls } = extractUrls(text);

    logger.info({ phoneNumber, clientId, igUrls, tiktokUrls }, 'waAutoSosmedTask: DM registered operator');

    const formattedDate = formatDate(new Date());
    const { igResults, tiktokResults } = await liveFetchAll(igUrls, tiktokUrls, clientId);

    try {
      await recordTasksToDB(igUrls, tiktokUrls, clientId, phoneNumber);
    } catch (err) {
      logger.error({ err, phoneNumber, clientId }, 'waAutoSosmedTask: DM DB insert failed');
    }

    // Response B
    const recapText = buildEngagementRecapText(igResults, tiktokResults, formattedDate);
    await enqueueSend(dmJid, { text: recapText });

    // Response C
    const ackTemplate = await getConfigOrDefault(clientId, 'task_input_ack', 'Tugas dari broadcast Anda telah diinputkan untuk klien {client_id}.');
    await enqueueSend(dmJid, { text: ackTemplate.replace('{client_id}', clientId) });

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