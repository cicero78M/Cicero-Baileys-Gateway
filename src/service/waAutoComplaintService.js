import { clientRequestHandlers } from '../handler/menu/clientRequestHandlers.js';
import { parseComplaintMessage } from './complaintParser.js';
import { triageComplaint } from './complaintTriageService.js';
import { fetchSocialProfile } from './rapidApiProfileService.js';

function normalizeWhatsAppId(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  if (/@[cs]\.us$/.test(trimmed) || trimmed.endsWith('@g.us')) {
    return trimmed;
  }
  const numeric = trimmed.replace(/\D/g, '');
  if (!numeric) return '';
  return `${numeric}@c.us`;
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

async function sendComplaintMessages(waClient, { chatId, senderId, triage }) {
  const throttleMs = Number(process.env.COMPLAINT_RESPONSE_DELAY_MS || 3000);
  await delay(throttleMs);
  await waClient.sendMessage(chatId, triage.operatorResponse);

  const requesterRecipient = normalizeWhatsAppId(senderId || chatId);
  if (!requesterRecipient || requesterRecipient === chatId) {
    return;
  }

  await delay(throttleMs);
  await waClient.sendMessage(requesterRecipient, triage.adminSummary);
}

function shouldUseLegacyComplaintFlow({ waClient }) {
  if (String(process.env.WA_COMPLAINT_USE_LEGACY_FLOW || '').toLowerCase() === 'true') {
    return true;
  }
  return typeof waClient?.sendMessage !== 'function';
}

async function handleWithLegacyResponder({
  chatId,
  text,
  adminOptionSessions,
  setSession,
  getSession,
  waClient,
  pool,
  userModel,
}) {
  const adminSession = adminOptionSessions?.[chatId];
  if (adminSession?.timeout) {
    clearTimeout(adminSession.timeout);
  }
  if (adminOptionSessions) {
    delete adminOptionSessions[chatId];
  }

  if (typeof setSession !== 'function' || typeof getSession !== 'function') {
    return false;
  }

  setSession(chatId, {
    menu: 'clientrequest',
    step: 'respondComplaint_message',
    respondComplaint: {},
  });

  const updatedSession = getSession(chatId);
  await clientRequestHandlers.respondComplaint_message(
    updatedSession,
    chatId,
    text,
    waClient,
    pool,
    userModel
  );
  return true;
}

export async function handleComplaintMessageIfApplicable({
  text,
  allowUserMenu,
  session,
  senderId,
  gatewayIds,
  chatId,
  adminOptionSessions,
  setSession,
  getSession,
  waClient,
  pool,
  userModel,
}) {
  if (!shouldHandleComplaintMessage({ text, allowUserMenu, session, senderId, gatewayIds, chatId })) {
    return false;
  }

  if (
    shouldUseLegacyComplaintFlow({ waClient }) &&
    (typeof setSession === 'function' || typeof getSession === 'function')
  ) {
    return handleWithLegacyResponder({
      chatId,
      text,
      adminOptionSessions,
      setSession,
      getSession,
      waClient,
      pool,
      userModel,
    });
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

  await sendComplaintMessages(waClient, { chatId, senderId, triage });
  return true;
}
