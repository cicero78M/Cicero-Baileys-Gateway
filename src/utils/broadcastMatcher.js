/**
 * broadcastMatcher.js
 * Keyword detection helpers for WA broadcast tugas sosmed messages.
 * All matching is case-insensitive with whole-word boundary (\b).
 */

/**
 * Build a whole-word case-insensitive regex from a CSV keyword string.
 * @param {string} keywordsCsv - e.g. "pagi,siang,sore,malam"
 * @returns {RegExp}
 */
export function buildKeywordRegex(keywordsCsv) {
  const words = keywordsCsv
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${words.join('|')})\\b`, 'i');
}

/**
 * Returns true only if ALL keywords in the CSV appear in the text (whole-word match).
 * @param {string} text
 * @param {string} keywordsCsv
 * @returns {boolean}
 */
export function hasAllKeywords(text, keywordsCsv) {
  const words = keywordsCsv
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);
  return words.every((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  });
}

/**
 * Returns true if ANY keyword in the CSV appears in the text (whole-word match).
 * @param {string} text
 * @param {string} keywordsCsv
 * @returns {boolean}
 */
export function hasAnyKeyword(text, keywordsCsv) {
  const regex = buildKeywordRegex(keywordsCsv);
  return regex.test(text);
}
