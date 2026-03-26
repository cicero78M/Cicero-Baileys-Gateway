import { parseComplaintMessage } from './complaintParser.js';
import { triageComplaint } from './complaintTriageService.js';
import { fetchSocialProfile } from './rapidApiProfileService.js';
import { enqueueSend } from './waOutbox.js';
import { logger } from '../utils/logger.js';
import {
  buildMismatchConfirmationDM,
} from './complaintResponseTemplates.js';
import {
  setConfirmation,
  getConfirmation,
  deleteConfirmation,
} from './pendingConfirmationStore.js';
import { updateUserSocialHandle } from '../repository/complaintRepository.js';

function normalizeWhatsAppId(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  // Pass through any already-formed JID (e.g. @s.whatsapp.net, @g.us, @c.us)
  if (trimmed.includes('@')) {
    return trimmed;
  }
  const numeric = trimmed.replace(/\D/g, '');
  if (!numeric) return '';
  return `${numeric}@s.whatsapp.net`;
}

function parseRecipientList(csvValue = '') {
  return String(csvValue || '')
    .split(',')
    .map((value) => normalizeWhatsAppId(value))
    .filter(Boolean);
}


function isGatewayForwardText(text) {
  if (!text) return false;
  const normalized = text.trim().toLowerCase();
  return /^(wagateway|wabot)\b/.test(normalized);
}

function delay(ms) {
  const normalizedMs = Number(ms);
  const safeMs = Number.isFinite(normalizedMs) && normalizedMs >= 0 ? normalizedMs : 3000;
  return new Promise((resolve) => setTimeout(resolve, safeMs));
}

export function isGatewayComplaintForward({
  senderId,
  chatId,
  text,
  gatewayIds,
  allowImplicitGatewayForward = false,
}) {
  const normalizedSender = normalizeWhatsAppId(senderId);
  const normalizedChatId = normalizeWhatsAppId(chatId);
  const knownGatewayIds = new Set([
    ...parseRecipientList(process.env.GATEWAY_WHATSAPP_ADMIN || ''),
    ...(gatewayIds || []).map((value) => normalizeWhatsAppId(value)),
  ]);
  const isKnownGatewaySender = normalizedSender && knownGatewayIds.has(normalizedSender);
  const hasGatewayForwardHeader = isGatewayForwardText(text);
  const isGroupContext = (normalizedChatId || normalizedSender || '').endsWith('@g.us');

  if (isKnownGatewaySender && isGroupContext) {
    return true;
  }

  if (hasGatewayForwardHeader && (isGroupContext || isKnownGatewaySender)) {
    return true;
  }

  if (allowImplicitGatewayForward) {
    if (!isGroupContext) {
      return true;
    }
  }

  return false;
}

function isCompleteComplaint(parsedComplaint) {
  return Boolean(parsedComplaint?.isComplaint && parsedComplaint?.reporter?.nrp);
}

export function shouldHandleComplaintMessage({ text, allowUserMenu, session, senderId, gatewayIds, chatId }) {
  if (allowUserMenu) return false;
  if (session?.menu === 'clientrequest') return false;

  const parsed = parseComplaintMessage(text);
  const isComplaint = isCompleteComplaint(parsed);

  if (!isComplaint && isGatewayComplaintForward({ senderId, chatId, text, gatewayIds })) {
    return false;
  }

  if (isComplaint) {
    return !isGatewayComplaintForward({ senderId, chatId, text, gatewayIds });
  }

  return false;
}

async function sendComplaintMessages({ chatId, senderId, triage }) {
  await enqueueSend(chatId, { text: triage.operatorResponse });

  const requesterRecipient = normalizeWhatsAppId(senderId || chatId);
  if (!requesterRecipient || requesterRecipient === chatId) {
    return;
  }

  await enqueueSend(requesterRecipient, { text: triage.adminSummary });
}

export async function handleComplaintMessageIfApplicable({
  text,
  allowUserMenu,
  session,
  senderId,
  gatewayIds,
  chatId,
  waClient,
  pool,
}) {
  if (!shouldHandleComplaintMessage({ text, allowUserMenu, session, senderId, gatewayIds, chatId })) {
    return false;
  }

  if (typeof waClient?.sendSeen === 'function') {
    try {
      await waClient.sendSeen(chatId);
    } catch (err) {
      logger.warn({ err, chatId }, 'sendSeen failed');
    }
  }

  const parsed = parseComplaintMessage(text);
  const dbQuery =
    typeof pool?.query === 'function'
      ? pool.query.bind(pool)
      : async () => ({ rows: [] });

  const triage = await triageComplaint(parsed, {
    db: { query: dbQuery },
    now: new Date(),
    rapidApi: fetchSocialProfile,
  });

  await sendComplaintMessages({ chatId, senderId, triage });

  // T017: USERNAME_MISMATCH — send DM to reporter + store confirmation session
  if (triage.diagnosisCode === 'USERNAME_MISMATCH' && senderId) {
    const senderJid = normalizeWhatsAppId(senderId);
    const reporter = parsed?.reporter || {};
    const usernameDb = triage.evidence?.internal?.usernameDb || {};
    const normalize = (v) => String(v || '').replace(/^@/, '').toLowerCase();
    const mismatchIg =
      reporter.igUsername &&
      normalize(reporter.igUsername) !== normalize(usernameDb.instagram);
    const platform = mismatchIg ? 'instagram' : 'tiktok';
    const oldUsername = mismatchIg ? usernameDb.instagram : usernameDb.tiktok;
    const newUsername = String(
      mismatchIg ? reporter.igUsername : reporter.tiktokUsername || ''
    ).replace(/^@/, '');
    const dmBody = buildMismatchConfirmationDM(triage, parsed);
    await enqueueSend(senderJid, { text: dmBody });
    setConfirmation(senderJid, platform, {
      senderJid,
      platform,
      oldUsername: oldUsername || '',
      newUsername,
      nrp: reporter.nrp,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    logger.info({ senderJid, platform, newUsername }, 'USERNAME_MISMATCH: confirmation DM enqueued');
  }

  return true;
}

// T018: Handle "ya konfirmasi ig/tiktok" DM replies
export async function handleConfirmationDM(msg, senderId) {
  // (1) Ignore group messages
  if (msg?.key?.remoteJid?.endsWith('@g.us')) return false;

  // (2) Extract body and match
  const body = (msg?.body || '').trim();
  const match = body.match(/ya konfirmasi (ig|tiktok)/i);
  if (!match) return false;

  // (3) Resolve platform
  const platform = match[1].toLowerCase() === 'ig' ? 'instagram' : 'tiktok';

  // (4) Look up confirmation session
  const senderJid = normalizeWhatsAppId(senderId || msg?.key?.remoteJid || '');
  const session = getConfirmation(senderJid, platform);
  if (!session) return false;

  // (5) Update DB via repository (C1: SQL only in repository)
  await updateUserSocialHandle(session.nrp, platform, session.newUsername);

  // (6) Send success message
  const platformLabel = platform === 'instagram' ? 'Instagram' : 'TikTok';
  const successMessage = `✅ Username berhasil diperbarui ke @${session.newUsername} untuk platform ${platformLabel}.`;
  await enqueueSend(senderJid, { text: successMessage });

  // (7) Remove session
  deleteConfirmation(senderJid, platform);

  // (8) Log
  logger.info({ senderJid, platform, newUsername: session.newUsername }, 'Confirmation DM handled: username updated');

  // (9) Return true to signal message was handled
  return true;
}
