/**
 * sosmedBroadcastParser.js
 * Detects WA broadcast tugas sosmed messages and extracts platform URLs.
 * All matching uses broadcastMatcher.js helpers (whole-word, case-insensitive).
 */

import { hasAnyKeyword, hasAllKeywords } from '../utils/broadcastMatcher.js';

const INDONESIAN_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const INDONESIAN_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const IG_PATTERN = /https?:\/\/(?:[a-z0-9-]+\.)*(?:instagram\.com|ig\.me)\/[^\s)>]*/gi;
const TIKTOK_PATTERN = /https?:\/\/(?:[a-z0-9-]+\.)*(?:tiktok\.com|vm\.tiktok\.com)\/[^\s)>]*/gi;

/**
 * Determine whether a raw WA message text is a broadcast tugas sosmed.
 *
 * Detection rules:
 *  1. Contains a salam waktu keyword (config.broadcast_trigger_keywords CSV)
 *  2. Contains the required phrase (config.broadcast_required_phrase)
 *  3. Contains ≥1 action keyword (config.broadcast_action_keywords CSV)
 *
 * @param {string} text
 * @param {{ broadcast_trigger_keywords: string, broadcast_required_phrase: string, broadcast_action_keywords: string }} config
 * @returns {boolean}
 */
function normaliseIndonesian(str) {
  return str
    .replace(/\bijin\b/gi, 'izin')
    .replace(/\bIjin\b/g, 'Izin');
}

export function isBroadcastMessage(text, config) {
  if (!text || typeof text !== 'string') return false;

  const normText = normaliseIndonesian(text);

  const hasSalam = hasAnyKeyword(normText, config.broadcast_trigger_keywords);
  if (!hasSalam) return false;

  const requiredPhrase = config.broadcast_required_phrase;
  const hasPhrase = normText.toLowerCase().includes(requiredPhrase.toLowerCase());
  if (!hasPhrase) return false;

  const hasAction = hasAnyKeyword(normText, config.broadcast_action_keywords);
  if (!hasAction) return false;

  return true;
}

/**
 * Extract Instagram and TikTok URLs from text.
 * Non-platform URLs are ignored per FR-007.
 *
 * @param {string} text
 * @returns {{ igUrls: string[], tiktokUrls: string[] }}
 */
export function extractUrls(text) {
  if (!text || typeof text !== 'string') return { igUrls: [], tiktokUrls: [] };

  const igUrls = Array.from(new Set((text.match(IG_PATTERN) || []).map((u) => u.trim())));
  const tiktokUrls = Array.from(new Set((text.match(TIKTOK_PATTERN) || []).map((u) => u.trim())));

  return { igUrls, tiktokUrls };
}

/**
 * Format a Date object as Indonesian long-form date string.
 * e.g. "Selasa, 25 Maret 2026"
 *
 * @param {Date} dateObj
 * @returns {string}
 */
export function formatDate(dateObj) {
  const jakartaDate = new Date(
    dateObj.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })
  );
  const day = INDONESIAN_DAYS[jakartaDate.getDay()];
  const date = jakartaDate.getDate();
  const month = INDONESIAN_MONTHS[jakartaDate.getMonth()];
  const year = jakartaDate.getFullYear();
  return `${day}, ${date} ${month} ${year}`;
}
