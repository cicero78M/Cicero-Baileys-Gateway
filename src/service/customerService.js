import { findEligibleCustomerByWhatsapp } from '../model/userModel.js';
import { recordCustomerServiceAudit } from '../repository/complaintRepository.js';
import { parseComplaintMessage } from './complaintParser.js';

const PROMPT_VERSION = 'cs-faq-v1';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

const KNOWLEDGE_BASE = [
  'Cicero adalah platform operasi digital untuk monitoring media sosial, absensi engagement, workflow editorial, dan pelaporan.',
  'Pertanyaan terkait status data, username, like, komentar, sinkronisasi, atau komplain harus diverifikasi berdasarkan data internal Cicero; jangan mengarang status.',
  'Jika data tidak tersedia, arahkan pengguna mengirim NRP/NIP dan bukti yang relevan melalui format komplain resmi, atau eskalasi ke operator.',
  'Jangan meminta atau mengungkap password, OTP, token, kredensial, data user lain, atau konfigurasi internal.',
].join('\n');

function normalizeJid(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.endsWith('@g.us') || raw.endsWith('@broadcast') || raw.endsWith('@newsletter')) return '';
  const digits = raw.replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : '';
}

function isCiceroRelated(text) {
  return /cicero|komplain|keluhan|kendala|error|gagal|akun|username|instagram|tiktok|like|komentar|absensi|sinkron|data|login|nrp|nip/i.test(text);
}

function isComplaintCandidate(text) {
  return /pesan\s+komplain|\bkomplain\b|\bkeluhan\b|\bkendala\b/i.test(text);
}

export async function authorizeCustomerServiceSender(senderId, db) {
  const senderJid = normalizeJid(senderId);
  if (!senderJid) return { allowed: false, senderJid: '' };
  const phone = senderJid.replace(/@s\.whatsapp\.net$/, '');
  try {
    const user = await findEligibleCustomerByWhatsapp(phone, db);
    return { allowed: Boolean(user), senderJid, user: user || null };
  } catch (err) {
    console.warn('[customer-service] authorization lookup failed:', err?.message || err);
    return { allowed: false, senderJid, error: 'lookup_failed' };
  }
}

async function generateGeminiAnswer(question) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return { text: '', model: null, estimatedCostUsd: null, unavailable: true };

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `Anda adalah CS Cicero. Jawab dalam Bahasa Indonesia, singkat dan sopan. Gunakan hanya knowledge base berikut:\n${KNOWLEDGE_BASE}\nJika jawabannya tidak ada, katakan perlu diteruskan ke operator.` }] },
        contents: [{ role: 'user', parts: [{ text: question }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
      }),
    });
    if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!text) throw new Error('Gemini returned empty response');
    return { text, model: MODEL, estimatedCostUsd: null, unavailable: false };
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleCustomerServiceMessage({ text, senderId, chatId, pool, send }) {
  const startedAt = Date.now();
  const auth = await authorizeCustomerServiceSender(senderId || chatId, pool);
  const baseAudit = {
    senderJid: auth.senderJid,
    messageText: text,
    userId: auth.user?.user_id,
    authorization: auth.allowed ? 'allowed' : 'denied',
    promptVersion: PROMPT_VERSION,
  };

  if (!auth.allowed) {
    await recordCustomerServiceAudit({ ...baseAudit, intent: 'blocked', responseStatus: 'ignored', latencyMs: Date.now() - startedAt }, pool);
    return { handled: isComplaintCandidate(text), authorized: false };
  }
  if (!isCiceroRelated(text)) {
    await recordCustomerServiceAudit({ ...baseAudit, intent: 'out_of_scope', responseStatus: 'ignored', latencyMs: Date.now() - startedAt }, pool);
    return { handled: true, authorized: true };
  }
  if (isComplaintCandidate(text)) {
    const parsed = parseComplaintMessage(text);
    const senderUserId = String(auth.user?.user_id || '').trim().toLowerCase();
    const reportedUserId = String(parsed?.reporter?.nrp || '').trim().toLowerCase();
    if (parsed.isComplaint && reportedUserId && reportedUserId !== senderUserId) {
      await recordCustomerServiceAudit({ ...baseAudit, intent: 'complaint_identity_mismatch', authorization: 'denied', responseStatus: 'ignored', latencyMs: Date.now() - startedAt }, pool);
      return { handled: true, authorized: false, identityMismatch: true };
    }
    return { handled: false, authorized: true, user: auth.user };
  }

  try {
    const answer = await generateGeminiAnswer(text);
    if (!answer.text) {
      await recordCustomerServiceAudit({ ...baseAudit, intent: 'faq', responseStatus: 'llm_unavailable', latencyMs: Date.now() - startedAt }, pool);
      await send('Pertanyaan sudah diterima. Layanan jawaban otomatis sedang tidak tersedia; pesan akan diteruskan ke operator Cicero.');
      return { handled: true, authorized: true, user: auth.user };
    }
    await send(answer.text);
    await recordCustomerServiceAudit({ ...baseAudit, intent: 'faq', model: answer.model, knowledgeSource: 'embedded-cicero-kb-v1', responseStatus: 'sent', latencyMs: Date.now() - startedAt, estimatedCostUsd: answer.estimatedCostUsd }, pool);
    return { handled: true, authorized: true, user: auth.user };
  } catch (err) {
    await recordCustomerServiceAudit({ ...baseAudit, intent: 'faq', model: MODEL, responseStatus: 'llm_error', latencyMs: Date.now() - startedAt }, pool);
    console.warn('[customer-service] LLM response failed:', err?.message || err);
    await send('Pertanyaan sudah diterima. Operator Cicero akan menindaklanjutinya.');
    return { handled: true, authorized: true, user: auth.user };
  }
}

export { isCiceroRelated, isComplaintCandidate, normalizeJid };
