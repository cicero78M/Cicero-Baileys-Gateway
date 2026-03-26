import { jest } from '@jest/globals';
import { buildKeywordRegex, hasAllKeywords, hasAnyKeyword } from '../src/utils/broadcastMatcher.js';

describe('buildKeywordRegex', () => {
  test('produces correct whole-word regex from CSV', () => {
    const regex = buildKeywordRegex('pagi,siang,sore');
    expect(regex.flags).toContain('i');
    expect(regex.test('selamat pagi')).toBe(true);
    expect(regex.test('SIANG hari')).toBe(true);
    expect(regex.test('selamat sore')).toBe(true);
    expect(regex.test('berapa')).toBe(false);
  });

  test('handles single keyword', () => {
    const regex = buildKeywordRegex('like');
    expect(regex.test('tolong like postingan ini')).toBe(true);
  });

  test('handles extra spaces in CSV', () => {
    const regex = buildKeywordRegex(' like , comment ');
    expect(regex.test('tolong like')).toBe(true);
    expect(regex.test('beri comment')).toBe(true);
  });
});

describe('hasAllKeywords', () => {
  test('returns true when all keywords present', () => {
    expect(hasAllKeywords('selamat pagi mohon izin', 'pagi,mohon')).toBe(true);
  });

  test('returns false when any keyword missing', () => {
    expect(hasAllKeywords('selamat pagi', 'pagi,malam')).toBe(false);
  });

  test('is case-insensitive', () => {
    expect(hasAllKeywords('SELAMAT PAGI', 'pagi')).toBe(true);
  });

  test('partial word match MUST NOT trigger', () => {
    // "paginya" should not match "pagi" keyword
    expect(hasAllKeywords('paginya cerah', 'pagi')).toBe(false);
  });
});

describe('hasAnyKeyword', () => {
  test('returns true when any keyword present', () => {
    expect(hasAnyKeyword('mohon like postingan', 'like,comment,share')).toBe(true);
  });

  test('returns false when no keywords present', () => {
    expect(hasAnyKeyword('halo apa kabar', 'like,comment,share')).toBe(false);
  });

  test('is case-insensitive', () => {
    expect(hasAnyKeyword('MOHON FOLLOW akun ini', 'follow')).toBe(true);
  });

  test('partial word match MUST NOT trigger', () => {
    // "likeliness" should not match "like"
    expect(hasAnyKeyword('likeliness is high', 'like')).toBe(false);
  });

  test('matches any one of multiple keywords', () => {
    expect(hasAnyKeyword('tolong subscribe channel ini', 'like,comment,subscribe')).toBe(true);
  });
});
