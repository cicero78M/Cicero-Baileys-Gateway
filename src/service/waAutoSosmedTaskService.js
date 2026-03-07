import { findClientById } from './clientService.js';
import { fetchSinglePostKhusus } from '../handler/fetchpost/instaFetchPost.js';
import { fetchAndStoreSingleTiktokPost } from '../handler/fetchpost/tiktokFetchPost.js';
import { generateSosmedTaskMessage } from '../handler/fetchabsensi/sosmedTask.js';

const AUTO_TASK_CLIENT_ID = 'DITINTELKAM';

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

export function cleanText(text) {
  return String(text || '')
    .replace(/\\n/g, ' ')
    .replace(/[,:;.!?()[\]{}"'“”‘’/\\|]+/g, ' ')
    .replace(/\u2060|\u200b|\u200c|\u200d/g, '');
}

function extractUrls(text) {
  const textForUrlScan = String(text || '')
    .replace(/\\n|\n/g, ' ')
    .replace(/\u2060|\u200b|\u200c|\u200d/g, '');
  const matches = textForUrlScan.match(/https?:\/\/[^\s)]+/gi);
  return Array.from(new Set((matches || []).map((url) => url.trim())));
}


function normalizeForMatching(text) {
  const normalized = cleanText(text).toLowerCase();
  return normalized
    .replace(/[~*_`]/g, ' ')
    .replace(/[•●▪◦◆►▶▷-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function evaluateSosmedTaskBroadcast(text) {
  const normalizedForMatch = normalizeForMatching(text);
  const urls = extractUrls(text);
  const { instagramLinks, tiktokLinks } = classifyUrls(urls);

  const rules = {
    salam: /\bselamat\s+(pagi|siang|sore|malam)\b/,
    mohonIjinDibantu: /\bmohon\s+i[sz]in(?:\s+dibantu|\s+bantu)?\b/,
    follow: /\bfollow\b/,
    subscribe: /\bsubscribe\b/,
    repost: /\brepost\b/,
  };

  const matchMap = {
    salam: rules.salam.test(normalizedForMatch),
    mohonIjinDibantu: rules.mohonIjinDibantu.test(normalizedForMatch),
    follow: rules.follow.test(normalizedForMatch),
    subscribe: rules.subscribe.test(normalizedForMatch),
    repost: rules.repost.test(normalizedForMatch),
  };

  const actionMatches = [
    matchMap.mohonIjinDibantu,
    matchMap.follow,
    matchMap.subscribe,
    matchMap.repost,
  ].filter(Boolean).length;
  const hasSupportedUrl = instagramLinks.length > 0 || tiktokLinks.length > 0;

  const score = Number(matchMap.salam) + actionMatches + Number(hasSupportedUrl);
  const threshold = 3;
  const failedRequirements = [];
  if (!matchMap.salam) {
    failedRequirements.push('salam');
  }
  if (actionMatches < 1) {
    failedRequirements.push('ajakan aksi');
  }
  if (!hasSupportedUrl) {
    failedRequirements.push('minimal 1 URL sosmed didukung');
  }
  if (score < threshold) {
    failedRequirements.push(`score<threshold (${score}<${threshold})`);
  }

  const result = {
    isMatch: failedRequirements.length === 0,
    normalizedForMatch,
    score,
    threshold,
    failedRequirements,
    ruleMatches: {
      ...matchMap,
      actionMatches,
      hasSupportedUrl,
    },
    urls,
    instagramLinks,
    tiktokLinks,
  };

  console.debug('[AUTO-SOSMED-TASK] Broadcast parser eval:', result);
  return result;
}

export function isSosmedTaskBroadcastFormat(text) {
  return evaluateSosmedTaskBroadcast(text).isMatch;
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

function resolveTargetClientId() {
  return AUTO_TASK_CLIENT_ID;
}

export async function handleAutoSosmedTaskMessageIfApplicable({ text, chatId, waClient }) {
  const broadcastEval = evaluateSosmedTaskBroadcast(text);
  if (!broadcastEval.isMatch) {
    console.debug('[AUTO-SOSMED-TASK] Broadcast format tidak lolos:', {
      normalizedForMatch: broadcastEval.normalizedForMatch,
      failedRequirements: broadcastEval.failedRequirements,
      ruleMatches: broadcastEval.ruleMatches,
    });
    return false;
  }

  const { instagramLinks, tiktokLinks } = broadcastEval;
  const targetClientId = resolveTargetClientId();

  try {
    const targetClient = await findClientById(targetClientId);
    if (!targetClient) {
      await waClient.sendMessage(
        chatId,
        `❌ Auto workflow dibatalkan karena client *${targetClientId}* tidak ditemukan.`
      );
      return true;
    }

    const targetLabel = `${targetClient.nama} (${targetClientId})`;

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
  } catch (error) {
    const shortStack = String(error?.stack || '')
      .split('\n')
      .slice(0, 5)
      .join('\n');

    console.error('[AUTO-SOSMED-TASK] Workflow gagal diproses:', {
      chatId,
      urlSummary: {
        total: instagramLinks.length + tiktokLinks.length,
        instagram: instagramLinks.length,
        tiktok: tiktokLinks.length,
      },
      errorMessage: error?.message || 'unknown_error',
      stack: shortStack,
    });

    await waClient.sendMessage(chatId, '⚠️ Auto workflow terdeteksi tapi gagal diproses, silakan cek log.');
  }

  return true;
}
