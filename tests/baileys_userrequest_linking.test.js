// Test to verify phone number linking behavior after Baileys migration
import { normalizeWhatsappNumber } from '../src/utils/waHelper.js';

describe('Baileys User Request Linking', () => {
  describe('normalizeWhatsappNumber()', () => {
    it('should normalize wwebjs format (@c.us)', () => {
      const chatId = '628123456789@c.us';
      const normalized = normalizeWhatsappNumber(chatId);
      expect(normalized).toBe('628123456789');
    });

    it('should normalize Baileys format (@s.whatsapp.net)', () => {
      const chatId = '628123456789@s.whatsapp.net';
      const normalized = normalizeWhatsappNumber(chatId);
      expect(normalized).toBe('628123456789');
    });

    // Note: This normalization is Indonesia-specific (0 → 62 country code)
    // The system is designed for Indonesian phone numbers
    it('should handle Indonesian phone numbers without country code', () => {
      const chatId = '08123456789@s.whatsapp.net';
      const normalized = normalizeWhatsappNumber(chatId);
      expect(normalized).toBe('628123456789');
    });

    it('should handle plain digits', () => {
      const chatId = '628123456789';
      const normalized = normalizeWhatsappNumber(chatId);
      expect(normalized).toBe('628123456789');
    });

    it('should handle phone with leading zero', () => {
      // Indonesian phone numbers starting with 0 are converted to 62 prefix
      const chatId = '08123456789';
      const normalized = normalizeWhatsappNumber(chatId);
      expect(normalized).toBe('628123456789');
    });

    it('should handle different suffixes consistently', () => {
      const wwebjsChatId = '628123456789@c.us';
      const baileysChatId = '628123456789@s.whatsapp.net';
      
      const normalizedWwebjs = normalizeWhatsappNumber(wwebjsChatId);
      const normalizedBaileys = normalizeWhatsappNumber(baileysChatId);
      
      expect(normalizedWwebjs).toBe(normalizedBaileys);
      expect(normalizedWwebjs).toBe('628123456789');
    });
  });

  describe('Database lookup consistency', () => {
    it('should use same format for lookup regardless of source', () => {
      // Simulate what happens in userMenuHandlers.js:46
      const wwebjsChatId = '628123456789@c.us';
      const baileysChatId = '628123456789@s.whatsapp.net';
      
      const pengirimWwebjs = normalizeWhatsappNumber(wwebjsChatId);
      const pengirimBaileys = normalizeWhatsappNumber(baileysChatId);
      
      // Both should produce the same value for DB lookup
      expect(pengirimWwebjs).toBe(pengirimBaileys);
      
      // This is what gets passed to findUserByWhatsApp(pengirim)
      // The query is: WHERE u.whatsapp = $1
      // So if DB has '628123456789', it should match both
      expect(pengirimBaileys).toBe('628123456789');
    });
  });
});
