/**
 * sosmedBroadcastParser.js
 * Detects WA broadcast tugas sosmed messages and extracts platform URLs.
 * All matching uses broadcastMatcher.js helpers (whole-word, case-insensitive).
 */

import { hasAnyKeyword } from '../utils/broadcastMatcher.js';

const INDONESIAN_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const INDONESIAN_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const IG_PATTERN = /https?:\/\/(?:[a-z0-9-]+\.)*(?:instagram\.com|ig\.me)\/[^\s)>]*/gi;
const TIKTOK_PATTERN = /https?:\/\/(?:[a-z0-9-]+\.)*(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)\/[^\s)>]*/gi;
const SECTION_URL_PATTERN = /https?:\/\/[^\s)>]+/gi;

function extractUrlsBySectionLabel(text, sectionLabels) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const urls = [];
  let active = false;

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) continue;

    const normalized = line.toUpperCase().replace(/\s+/g, '');
    const isSectionHeader = normalized.endsWith(':');
    if (isSectionHeader) {
      active = sectionLabels.some((label) => normalized.startsWith(`${label}:`));
      continue;
    }

    if (!active) continue;

    const found = line.match(SECTION_URL_PATTERN) || [];
    urls.push(...found);
  }

  return urls;
}

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

function normalizeForKeywordMatching(str) {
  return normaliseIndonesian(String(str || ''))
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isBroadcastMessage(text, config) {
  if (!text || typeof text !== 'string') return false;

  const normText = normaliseIndonesian(text);
  const normalizedTextForMatch = normalizeForKeywordMatching(text);

  const hasSalam = hasAnyKeyword(
    normalizedTextForMatch,
    normalizeForKeywordMatching(config.broadcast_trigger_keywords).replace(/\s+/g, ',')
  );
  if (!hasSalam) return false;

  const requiredPhrase = normalizeForKeywordMatching(config.broadcast_required_phrase);
  const hasPhrase = normalizedTextForMatch.includes(requiredPhrase);
  if (!hasPhrase) return false;

  const hasAction = hasAnyKeyword(
    normalizedTextForMatch,
    normalizeForKeywordMatching(config.broadcast_action_keywords).replace(/\s+/g, ',')
  );
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

  const igSectionUrls = extractUrlsBySectionLabel(text, ['INSTAGRAM', 'IG']);
  const tiktokSectionUrls = extractUrlsBySectionLabel(text, ['TIKTOK', 'TIK TOK']);

  const igUrls = Array.from(
    new Set([...(text.match(IG_PATTERN) || []), ...igSectionUrls].map((u) => u.trim()))
  );
  const tiktokUrls = Array.from(
    new Set([...(text.match(TIKTOK_PATTERN) || []), ...tiktokSectionUrls].map((u) => u.trim()))
  );

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
