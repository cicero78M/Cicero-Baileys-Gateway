/**
 * operatorRegistrationService.js
 * 3-state dialog machine for operator self-registration via WA DM.
 *
 * States: awaiting_confirmation → awaiting_satker_choice → (registered|declined)
 *
 * FR-018: No circular import with waAutoSosmedTaskService — replay handled via
 * injected `replayBroadcast` callback.
 */

import { query } from '../db/postgres.js';
import { getConfig } from './clientConfigService.js';
import {
  findActiveSession,
  upsertSession,
  deleteSession,
  isRateLimited,
} from '../repository/operatorRegistrationSessionRepository.js';
import { upsertOperator } from '../repository/operatorRepository.js';
import { logger } from '../utils/logger.js';

// Pool proxy: operatorRegistrationService accepts pool-shaped arg; we wrap the
// shared postgres.js `query` so repositories receive a consistent interface.
const pool = { query: (sql, params) => query(sql, params) };

const YA_TOKENS = new Set(['ya', 'iya', 'yes', 'y', 'ok', 'okay', 'setuju', 'benar', 'betul', 'daftar']);
const TIDAK_TOKENS = new Set(['tidak', 'no', 'batal', 'cancel', 'n', 'stop', 'tolak']);

/**
 * Fetch satker list from active clients ordered by name.
 * @returns {Promise<Array<{client_id: string, nama: string}>>}
 */
async function fetchActiveSatkerList() {
  const result = await query(
    `SELECT client_id, nama FROM clients WHERE client_status = TRUE ORDER BY nama`
  );
  return result.rows;
}

/**
 * Build Response E text (satker list) from active clients.
 * @param {string} header - from client_config.operator_satker_list_header
 * @param {Array<{client_id: string, nama: string}>} satkers
 * @returns {string}
 */
function buildSatkerListText(header, satkers) {
  const lines = satkers.map((s, i) => `${i + 1}. ${s.nama}`);
  return `${header}\n${lines.join('\n')}`;
}

/**
 * Handle a DM from an unregistered phone number that sent a broadcast-format message.
 * Checks rate limit, then upserts session and sends Response D (confirmation prompt).
 *
 * @param {string} phoneNumber - sender phone in international format (e.g. "628123456789")
 * @param {string} rawText - original WA message text to be replayed after registration
 * @param {function(string, {text: string}): Promise<void>} enqueueSend
 * @param {string} [replyJid] - actual JID to reply to; defaults to `${phoneNumber}@s.whatsapp.net`.
 *   Pass explicitly when the sender's JID differs (e.g. `@lid` users).
 * @returns {Promise<void>}
 */
export async function handleUnregisteredBroadcast(phoneNumber, rawText, enqueueSend, replyJid) {
  const maxAttempts = parseInt(await getConfig('DEFAULT', 'operator_registration_max_attempts') ?? '3', 10);
  const cooldownMinutes = parseInt(await getConfig('DEFAULT', 'operator_registration_cooldown_minutes') ?? '60', 10);
  const ttlSeconds = parseInt(await getConfig('DEFAULT', 'operator_session_ttl_seconds') ?? '3600', 10);

  const limited = await isRateLimited(pool, phoneNumber, maxAttempts, cooldownMinutes);
  if (limited) {
    logger.warn({ phoneNumber }, 'operatorRegistration: rate-limited, suppressing prompt');
    return;
  }

  await upsertSession(pool, phoneNumber, 'awaiting_confirmation', rawText, ttlSeconds, cooldownMinutes);

  const promptText = await getConfig('DEFAULT', 'operator_unregistered_prompt')
    ?? 'Anda mengirim pesan tugas untuk dieksekusi, tapi database kami belum membaca Satker Asal anda. Apakah anda ingin mendaftarkan nomor anda sebagai operator tugas? (ya/tidak)';
  const promptJid = replyJid ?? `${phoneNumber}@s.whatsapp.net`;
  await enqueueSend(promptJid, { text: promptText });

  logger.info({ phoneNumber }, 'operatorRegistration: sent D prompt');
}

/**
 * Handle a reply from a phone number that has an active registration session.
 * Routes by session stage.
 *
 * @param {string} phoneNumber
 * @param {string} replyText - the raw reply text from the user
 * @param {function(string, {text: string}): Promise<void>} enqueueSend
 * @param {function(string): Promise<void>} replayBroadcast - called with original_message on success
 * @param {string} [replyJid] - actual JID to reply to; defaults to `${phoneNumber}@s.whatsapp.net`.
 * @returns {Promise<void>}
 */
export async function handleRegistrationDialog(phoneNumber, replyText, enqueueSend, replayBroadcast, replyJid) {
  const session = await findActiveSession(pool, phoneNumber);
  if (!session) {
    logger.warn({ phoneNumber }, 'operatorRegistration: dialog called but no active session');
    return;
  }

  const jid = replyJid ?? `${phoneNumber}@s.whatsapp.net`;

  if (session.stage === 'awaiting_confirmation') {
    await handleConfirmationReply(phoneNumber, jid, replyText, session, enqueueSend);
    return;
  }

  if (session.stage === 'awaiting_satker_choice') {
    await handleSatkerChoiceReply(phoneNumber, jid, replyText, session, enqueueSend, replayBroadcast);
    return;
  }

  logger.warn({ phoneNumber, stage: session.stage }, 'operatorRegistration: unknown stage');
}

/**
 * @private
 */
async function handleConfirmationReply(phoneNumber, jid, replyText, session, enqueueSend) {
  const token = replyText.trim().toLowerCase();

  if (YA_TOKENS.has(token)) {
    const ttlSeconds = parseInt(await getConfig('DEFAULT', 'operator_session_ttl_seconds') ?? '3600', 10);
    const cooldownMinutes = parseInt(await getConfig('DEFAULT', 'operator_registration_cooldown_minutes') ?? '60', 10);

    // Advance stage to awaiting_satker_choice and send Response E (satker list)
    await upsertSession(pool, phoneNumber, 'awaiting_satker_choice', session.original_message, ttlSeconds, cooldownMinutes);

    const satkers = await fetchActiveSatkerList();
    const header = await getConfig('DEFAULT', 'operator_satker_list_header')
      ?? 'Pilih Satker Anda dengan membalas nomor urut:';

    if (satkers.length === 0) {
      const noSatkerText = await getConfig('DEFAULT', 'operator_no_satker')
        ?? 'Tidak ada Satker aktif. Hubungi administrator.';
      await enqueueSend(jid, { text: noSatkerText });
      await deleteSession(pool, phoneNumber);
      return;
    }

    await enqueueSend(jid, { text: buildSatkerListText(header, satkers) });
    logger.info({ phoneNumber }, 'operatorRegistration: sent E satker list');
    return;
  }

  if (TIDAK_TOKENS.has(token)) {
    await deleteSession(pool, phoneNumber);
    const declinedText = await getConfig('DEFAULT', 'operator_registration_declined')
      ?? 'Baik, pendaftaran dibatalkan.';
    await enqueueSend(jid, { text: declinedText });
    logger.info({ phoneNumber }, 'operatorRegistration: registration declined, sent G');
    return;
  }

  // Unrecognised reply in confirmation stage — treat as invalid
  logger.info({ phoneNumber, token }, 'operatorRegistration: unrecognised confirmation token');
}

/**
 * @private
 */
async function handleSatkerChoiceReply(phoneNumber, jid, replyText, session, enqueueSend, replayBroadcast) {
  const satkers = await fetchActiveSatkerList();

  if (satkers.length === 0) {
    const noSatkerText = await getConfig('DEFAULT', 'operator_no_satker')
      ?? 'Tidak ada Satker aktif. Hubungi administrator.';
    await enqueueSend(jid, { text: noSatkerText });
    await deleteSession(pool, phoneNumber);
    return;
  }

  const choiceIndex = parseInt(replyText.trim(), 10);
  const selectedSatker = satkers[choiceIndex - 1]; // 1-based

  if (!Number.isInteger(choiceIndex) || !selectedSatker) {
    const invalidText = await getConfig('DEFAULT', 'operator_invalid_choice')
      ?? 'Pilihan tidak valid. Silakan balas dengan nomor urut.';
    const header = await getConfig('DEFAULT', 'operator_satker_list_header')
      ?? 'Pilih Satker Anda dengan membalas nomor urut:';

    await enqueueSend(jid, { text: invalidText });                                        // Response H
    await enqueueSend(jid, { text: buildSatkerListText(header, satkers) });               // Response E

    logger.info({ phoneNumber, replyText }, 'operatorRegistration: invalid satker choice, resent E');
    return;
  }

  // Valid choice — complete registration
  await upsertOperator(pool, phoneNumber, selectedSatker.client_id, selectedSatker.nama);
  await deleteSession(pool, phoneNumber);

  const ackTemplate = await getConfig('DEFAULT', 'operator_registration_ack')
    ?? 'Nomor Anda berhasil terdaftar sebagai operator untuk {satker_name}. Anda dapat mengirim pesan tugas kembali.';
  const ackText = ackTemplate.replace('{satker_name}', selectedSatker.nama);
  await enqueueSend(jid, { text: ackText });                                              // Response F

  logger.info({ phoneNumber, satker: selectedSatker.nama }, 'operatorRegistration: registered, sent F');

  // Replay the original broadcast now that the operator is registered
  await replayBroadcast(session.original_message);
}
