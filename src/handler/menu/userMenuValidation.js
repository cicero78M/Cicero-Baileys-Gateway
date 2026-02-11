// src/handler/menu/userMenuValidation.js

/**
 * Validation utilities for user menu input
 * Centralizes validation logic for better maintainability and consistency
 */

// Field length limits
export const FIELD_LIMITS = {
  nama: { min: 2, max: 100 },
  jabatan: { min: 2, max: 100 },
  desa: { min: 2, max: 100 },
  nrp: { min: 6, max: 18 },
  instagram: { min: 1, max: 30 },
  tiktok: { min: 1, max: 30 },
};

// Reserved usernames that cannot be used
export const RESERVED_USERNAMES = ['cicero_devs', 'admin', 'superadmin'];

/**
 * Validate NRP/NIP input
 * @param {string} input - Raw user input
 * @returns {{valid: boolean, digits: string, error: string}}
 */
export function validateNRP(input) {
  const digits = input.replace(/\D/g, '');
  
  if (!digits) {
    return {
      valid: false,
      digits: '',
      error: [
        '❌ NRP/NIP harus berupa angka.',
        'Sistem otomatis menghapus karakter non-angka sehingga pastikan angka yang tersisa membentuk NRP/NIP yang benar.',
        '',
        'Contoh: 87020990',
        'Ketik *batal* untuk keluar.',
      ].join('\n'),
    };
  }
  
  if (digits.length < FIELD_LIMITS.nrp.min || digits.length > FIELD_LIMITS.nrp.max) {
    return {
      valid: false,
      digits: '',
      error: [
        `❌ NRP/NIP harus terdiri dari ${FIELD_LIMITS.nrp.min}-${FIELD_LIMITS.nrp.max} digit angka setelah karakter non-angka dibuang.`,
        '',
        'Contoh: 87020990',
        'Ketik *batal* untuk keluar.',
      ].join('\n'),
    };
  }
  
  return { valid: true, digits, error: '' };
}

/**
 * Validate text field (nama, jabatan, desa)
 * @param {string} fieldName - Field name for error messages
 * @param {string} value - User input
 * @returns {{valid: boolean, value: string, error: string}}
 * @note Currently converts to UPPERCASE for database convention.
 *       If adding fields requiring different casing, make this parameter-based.
 */
export function validateTextField(fieldName, value) {
  const trimmed = value.trim();
  const limits = FIELD_LIMITS[fieldName] || { min: 2, max: 100 };
  
  if (trimmed.length < limits.min) {
    return {
      valid: false,
      value: '',
      error: `❌ ${fieldName} minimal ${limits.min} karakter. Ketik *batal* untuk membatalkan.`,
    };
  }
  
  if (trimmed.length > limits.max) {
    return {
      valid: false,
      value: '',
      error: `❌ ${fieldName} maksimal ${limits.max} karakter. Ketik *batal* untuk membatalkan.`,
    };
  }
  
  return { valid: true, value: trimmed.toUpperCase(), error: '' };
}

/**
 * Validate Instagram username or URL
 * @param {string} input - Instagram username or profile URL
 * @returns {{valid: boolean, username: string, error: string}}
 */
export function validateInstagram(input) {
  const igMatch = input.match(
    /^(?:https?:\/\/(?:www\.)?instagram\.com\/)?@?([A-Za-z0-9._]+)\/?(?:\?.*)?$/i
  );
  
  if (!igMatch) {
    return {
      valid: false,
      username: '',
      error: [
        '❌ Input Instagram tidak valid!',
        'Masukkan *link profil* atau *username Instagram*',
        '',
        'Contoh: https://instagram.com/username atau @username',
        'Ketik *batal* untuk membatalkan.',
      ].join('\n'),
    };
  }
  
  const username = igMatch[1].toLowerCase();
  
  if (username.length < FIELD_LIMITS.instagram.min || username.length > FIELD_LIMITS.instagram.max) {
    return {
      valid: false,
      username: '',
      error: `❌ Username Instagram harus ${FIELD_LIMITS.instagram.min}-${FIELD_LIMITS.instagram.max} karakter. Ketik *batal* untuk membatalkan.`,
    };
  }
  
  if (RESERVED_USERNAMES.includes(username)) {
    return {
      valid: false,
      username: '',
      error: [
        '❌ Username tersebut adalah akun sistem/admin.',
        'Gunakan akun Instagram Anda sendiri.',
        '',
        'Ketik *batal* untuk membatalkan.',
      ].join('\n'),
    };
  }
  
  return { valid: true, username, error: '' };
}

/**
 * Validate TikTok username or URL
 * @param {string} input - TikTok username or profile URL
 * @returns {{valid: boolean, username: string, error: string}}
 */
export function validateTikTok(input) {
  const ttMatch = input.match(
    /^(?:https?:\/\/(?:www\.)?tiktok\.com\/@)?@?([A-Za-z0-9._]+)\/?(?:\?.*)?$/i
  );
  
  if (!ttMatch) {
    return {
      valid: false,
      username: '',
      error: [
        '❌ Input TikTok tidak valid!',
        'Masukkan *link profil* atau *username TikTok*',
        '',
        'Contoh: https://tiktok.com/@username atau @username',
        'Ketik *batal* untuk membatalkan.',
      ].join('\n'),
    };
  }
  
  const username = ttMatch[1].toLowerCase();
  
  if (username.length < FIELD_LIMITS.tiktok.min || username.length > FIELD_LIMITS.tiktok.max) {
    return {
      valid: false,
      username: '',
      error: `❌ Username TikTok harus ${FIELD_LIMITS.tiktok.min}-${FIELD_LIMITS.tiktok.max} karakter. Ketik *batal* untuk membatalkan.`,
    };
  }
  
  return { valid: true, username, error: '' };
}

/**
 * Validate selection from numbered list
 * @param {string} input - User input (number or text)
 * @param {Array<string>} options - Available options
 * @returns {{valid: boolean, selected: string, error: string}}
 */
export function validateListSelection(input, options) {
  const trimmed = input.trim();
  
  // Check if input is a number
  if (/^\d+$/.test(trimmed)) {
    const idx = parseInt(trimmed, 10) - 1;
    if (idx >= 0 && idx < options.length) {
      return { valid: true, selected: options[idx], error: '' };
    }
    const msgList = options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
    return {
      valid: false,
      selected: '',
      error: [
        '❌ Pilihan tidak valid! Pilih sesuai daftar:',
        '',
        msgList,
        '',
        'Balas dengan angka atau nama sesuai daftar, atau ketik *batal* untuk membatalkan.',
      ].join('\n'),
    };
  }
  
  // Check if input matches any option (case-insensitive)
  const normalizedOptions = options.map((opt) => opt.toUpperCase());
  const upperInput = trimmed.toUpperCase();
  
  if (normalizedOptions.includes(upperInput)) {
    const idx = normalizedOptions.indexOf(upperInput);
    return { valid: true, selected: options[idx], error: '' };
  }
  
  const msgList = options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
  return {
    valid: false,
    selected: '',
    error: [
      '❌ Pilihan tidak valid! Pilih sesuai daftar:',
      '',
      msgList,
      '',
      'Balas dengan angka atau nama sesuai daftar, atau ketik *batal* untuk membatalkan.',
    ].join('\n'),
  };
}
