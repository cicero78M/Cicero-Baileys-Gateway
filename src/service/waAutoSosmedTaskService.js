import { findClientById } from './clientService.js';
import { fetchSinglePostKhusus } from '../handler/fetchpost/instaFetchPost.js';
import { fetchAndStoreSingleTiktokPost } from '../handler/fetchpost/tiktokFetchPost.js';
import { generateSosmedTaskMessage } from '../handler/fetchabsensi/sosmedTask.js';

const DEFAULT_CLIENT_ID = 'DITBINMAS';

function getJakartaDayDateLabel() {
  const now = new Date();
  const hari = now.toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
  });
  const tanggal = now.toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  return `${hari}, ${tanggal}`;
}

function cleanText(text) {
  return String(text || '').replace(/\u2060|\u200b|\u200c|\u200d/g, '');
}

function extractUrls(text) {
  const matches = cleanText(text).match(/https?:\/\/[^\s)]+/gi);
  return Array.from(new Set((matches || []).map((url) => url.trim())));
}

function isSosmedTaskBroadcastFormat(text) {
  const normalized = cleanText(text).toLowerCase();
  return (
    normalized.includes('selamat siang komandan') &&
    normalized.includes('mohon ijin dibantu') &&
    normalized.includes('follow') &&
    normalized.includes('subscribe') &&
    normalized.includes('repost')
  );
}

function classifyUrls(urls) {
  const instagramLinks = [];
  const tiktokLinks = [];

  for (const url of urls) {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('instagram.com/')) {
      instagramLinks.push(url);
      continue;
    }
    if (lowerUrl.includes('tiktok.com/')) {
      tiktokLinks.push(url);
    }
  }

  return { instagramLinks, tiktokLinks };
}

function resolveTargetClientId(session) {
  const rawClientId =
    session?.dir_client_id ||
    session?.selectedClientId ||
    process.env.WA_AUTO_TASK_CLIENT_ID ||
    DEFAULT_CLIENT_ID;
  return String(rawClientId || DEFAULT_CLIENT_ID).trim().toUpperCase();
}

export async function handleAutoSosmedTaskMessageIfApplicable({ text, chatId, session, waClient }) {
  if (!isSosmedTaskBroadcastFormat(text)) {
    return false;
  }

  const urls = extractUrls(text);
  const { instagramLinks, tiktokLinks } = classifyUrls(urls);

  if (!instagramLinks.length && !tiktokLinks.length) {
    return false;
  }

  const targetClientId = resolveTargetClientId(session);
  const targetClient = await findClientById(targetClientId);
  const targetLabel = targetClient?.nama
    ? `${targetClient.nama} (${targetClientId})`
    : targetClientId;

  await waClient.sendMessage(
    chatId,
    `⏳ Format broadcast tugas terdeteksi. Menjalankan workflow otomatis Input post manual + Ambil pesan list tugas untuk *${targetLabel}*.`
  );

  const igShortcodes = [];
  const tiktokVideoIds = [];
  const failures = [];

  for (const instagramLink of instagramLinks) {
    try {
      const result = await fetchSinglePostKhusus(instagramLink, targetClientId);
      if (result?.shortcode) {
        igShortcodes.push(result.shortcode);
      }
    } catch (error) {
      failures.push(`IG ${instagramLink} => ${error?.message || 'gagal diproses'}`);
    }
  }

  for (const tiktokLink of tiktokLinks) {
    try {
      const result = await fetchAndStoreSingleTiktokPost(targetClientId, tiktokLink);
      if (result?.videoId) {
        tiktokVideoIds.push(result.videoId);
      }
    } catch (error) {
      failures.push(`TikTok ${tiktokLink} => ${error?.message || 'gagal diproses'}`);
    }
  }

  if (igShortcodes.length) {
    const { handleFetchLikesInstagram } = await import('../handler/fetchengagement/fetchLikesInstagram.js');
    await handleFetchLikesInstagram(null, null, targetClientId, {
      shortcodes: igShortcodes,
      sourceType: 'manual_input',
      enrichComments: false,
    });
  }

  if (tiktokVideoIds.length) {
    const { handleFetchKomentarTiktokBatch } = await import('../handler/fetchengagement/fetchCommentTiktok.js');
    await handleFetchKomentarTiktokBatch(null, null, targetClientId, {
      videoIds: tiktokVideoIds,
      sourceType: 'manual_input',
    });
  }

  const { text: taskMessage } = await generateSosmedTaskMessage(targetClientId, {
    skipTiktokFetch: true,
    skipLikesFetch: true,
  });

  const statusSummary =
    `✅ Input manual selesai.` +
    `\n• Instagram diproses: ${instagramLinks.length}` +
    `\n• TikTok diproses: ${tiktokLinks.length}` +
    `\n• Gagal: ${failures.length}`;

  await waClient.sendMessage(chatId, statusSummary);

  if (failures.length) {
    await waClient.sendMessage(chatId, `⚠️ Detail gagal:\n${failures.map((item) => `- ${item}`).join('\n')}`);
  }

  const tanggalPengambilan = getJakartaDayDateLabel();
  await waClient.sendMessage(
    chatId,
    `*Header Pesan Tugas*\n` +
      `Pesan list tugas Instagram & TikTok untuk *${targetClientId}*\n` +
      `Hari/Tanggal pengambilan tugas: ${tanggalPengambilan}\n\n` +
      `${taskMessage}`
  );

  return true;
}

