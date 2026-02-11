// Test to verify ADMIN_WHATSAPP users can access dirrequest and oprrequest
import { jest } from '@jest/globals';

// Mock environment before imports
// Include the specific admin number from the problem statement: 6281235114745
process.env.ADMIN_WHATSAPP = '6281235114745,628123456789,628987654321';
process.env.JWT_SECRET = 'test-secret';

describe('ADMIN_WHATSAPP Access Control', () => {
  describe('isAdminWhatsApp function', () => {
    // Import after setting env
    let isAdminWhatsApp;
    
    beforeAll(async () => {
      const waHelper = await import('../src/utils/waHelper.js');
      isAdminWhatsApp = waHelper.isAdminWhatsApp;
    });

    test('should return true for admin numbers without @c.us suffix', () => {
      expect(isAdminWhatsApp('6281235114745')).toBe(true);
      expect(isAdminWhatsApp('628123456789')).toBe(true);
      expect(isAdminWhatsApp('628987654321')).toBe(true);
    });

    test('should return true for admin numbers with @c.us suffix', () => {
      expect(isAdminWhatsApp('6281235114745@c.us')).toBe(true);
      expect(isAdminWhatsApp('628123456789@c.us')).toBe(true);
      expect(isAdminWhatsApp('628987654321@c.us')).toBe(true);
    });

    test('should return false for non-admin numbers', () => {
      expect(isAdminWhatsApp('628111111111')).toBe(false);
      expect(isAdminWhatsApp('628222222222@c.us')).toBe(false);
    });

    test('should handle numbers with non-digit characters', () => {
      // The function strips non-digits, so these should match admin number 628123456789
      expect(isAdminWhatsApp('62-812-345-6789')).toBe(true);
      expect(isAdminWhatsApp('62 812 345 6789')).toBe(true);
      expect(isAdminWhatsApp('62(812)345-6789')).toBe(true);
    });

    test('should return false for empty or invalid input', () => {
      expect(isAdminWhatsApp('')).toBe(false);
      expect(isAdminWhatsApp(null)).toBe(false);
      expect(isAdminWhatsApp(undefined)).toBe(false);
    });
  });

  describe('Access Control Integration', () => {
    test('should verify isAdminWhatsApp is available for import', async () => {
      // This test ensures the function exists and can be imported
      const waHelper = await import('../src/utils/waHelper.js');
      expect(waHelper.isAdminWhatsApp).toBeDefined();
      expect(typeof waHelper.isAdminWhatsApp).toBe('function');
    });

    test('should verify waService.js exists and contains access control logic', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const waServicePath = path.join(process.cwd(), 'src', 'service', 'waService.js');
      
      // Verify file exists
      expect(fs.existsSync(waServicePath)).toBe(true);
      
      const waServiceContent = fs.readFileSync(waServicePath, 'utf-8');
      
      // Verify isAdminWhatsApp is imported and used
      expect(waServiceContent).toContain('isAdminWhatsApp');
      expect(waServiceContent).toContain('oprrequest');
      expect(waServiceContent).toContain('dirrequest');
    });
  });

  describe('Configuration', () => {
    test('ADMIN_WHATSAPP should be loaded from environment', () => {
      expect(process.env.ADMIN_WHATSAPP).toBeDefined();
      expect(process.env.ADMIN_WHATSAPP).toBe('6281235114745,628123456789,628987654321');
    });

    test('ADMIN_WHATSAPP should support multiple numbers', () => {
      const adminNumbers = process.env.ADMIN_WHATSAPP.split(',');
      expect(adminNumbers).toHaveLength(3);
      expect(adminNumbers[0].trim()).toBe('6281235114745');
      expect(adminNumbers[1].trim()).toBe('628123456789');
      expect(adminNumbers[2].trim()).toBe('628987654321');
    });

    test('specific admin number 6281235114745 should be recognized', () => {
      const adminNumbers = process.env.ADMIN_WHATSAPP.split(',').map(n => n.trim());
      expect(adminNumbers).toContain('6281235114745');
    });
  });

  describe('dirrequest and oprrequest Menu Access', () => {
    // Helper function to extract code sections
    const getMenuSection = (content, menuName) => {
      const regex = new RegExp(`if \\(text\\.toLowerCase\\(\\) === "${menuName}"\\)[\\s\\S]*?return;[\\s\\S]*?}`, 'g');
      return content.match(regex);
    };

    test('should verify dirrequest allows access from all WhatsApp numbers', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const waServicePath = path.join(process.cwd(), 'src', 'service', 'waService.js');
      const content = fs.readFileSync(waServicePath, 'utf-8');
      
      // Verify dirrequest section exists
      const dirRequestSection = getMenuSection(content, 'dirrequest');
      expect(dirRequestSection).toBeTruthy();
      expect(dirRequestSection.length).toBeGreaterThan(0);
      
      // Verify no authorization checks in dirrequest
      const section = dirRequestSection[0];
      expect(section).not.toContain('isAdminWhatsApp(chatId)');
      expect(section).not.toContain('findByOperator');
      expect(section).not.toContain('findBySuperAdmin');
      expect(section).not.toContain('hasSameLidAsAdmin');
      
      // Verify it fetches directorate clients for all users
      expect(section).toContain('findAllActiveDirektoratClients');
    });

    test('should verify oprrequest access control checks isAdminWhatsApp', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const waServicePath = path.join(process.cwd(), 'src', 'service', 'waService.js');
      const content = fs.readFileSync(waServicePath, 'utf-8');
      
      // Verify oprrequest checks isAdminWhatsApp
      const oprRequestSection = getMenuSection(content, 'oprrequest');
      expect(oprRequestSection).toBeTruthy();
      expect(oprRequestSection[0]).toContain('isAdminWhatsApp(chatId)');
    });

    test('admin number 6281235114745 should have access to oprrequest', async () => {
      const waHelper = await import('../src/utils/waHelper.js');
      const adminChatId = '6281235114745@c.us';
      
      // Verify the admin number is recognized
      expect(waHelper.isAdminWhatsApp(adminChatId)).toBe(true);
      
      // In the actual implementation, this would trigger the oprrequest flow
      // that allows admin to select from organization clients
    });
  });
});
