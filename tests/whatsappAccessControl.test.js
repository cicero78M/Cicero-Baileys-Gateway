// Test WhatsApp number access control and uniqueness constraints
import { jest } from '@jest/globals';

const mockQuery = jest.fn();

jest.unstable_mockModule('../src/repository/db.js', () => ({
  query: mockQuery
}));

let updateUserField;
let findUserByWhatsApp;

beforeAll(async () => {
  const mod = await import('../src/model/userModel.js');
  updateUserField = mod.updateUserField;
  findUserByWhatsApp = mod.findUserByWhatsApp;
});

beforeEach(() => {
  mockQuery.mockReset();
});

describe('WhatsApp number uniqueness enforcement', () => {
  test('updateUserField rejects WhatsApp number already in use by another user', async () => {
    // Mock findUserByWhatsApp to return an existing user with different user_id
    mockQuery.mockResolvedValueOnce({ 
      rows: [{ user_id: '87020990', whatsapp: '628123456789' }] 
    });

    await expect(
      updateUserField('12345678', 'whatsapp', '628123456789')
    ).rejects.toThrow('Nomor WhatsApp ini sudah terdaftar pada akun lain');
  });

  test('updateUserField allows updating WhatsApp for same user', async () => {
    // Mock findUserByWhatsApp to return the same user
    mockQuery
      .mockResolvedValueOnce({ 
        rows: [{ user_id: '12345678', whatsapp: '628123456789' }] 
      })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE query
      .mockResolvedValueOnce({ // findUserById query
        rows: [{ user_id: '12345678', whatsapp: '628123456789', nama: 'Test User' }] 
      });

    const result = await updateUserField('12345678', 'whatsapp', '628123456789');
    expect(result.user_id).toBe('12345678');
  });

  test('updateUserField allows linking WhatsApp to user without existing number', async () => {
    // Mock findUserByWhatsApp to return no user (number not in use)
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // findUserByWhatsApp
      .mockResolvedValueOnce({ rows: [] }) // UPDATE query
      .mockResolvedValueOnce({ // findUserById query
        rows: [{ user_id: '12345678', whatsapp: '628123456789', nama: 'Test User' }] 
      });

    const result = await updateUserField('12345678', 'whatsapp', '628123456789');
    expect(result.user_id).toBe('12345678');
  });

  test('updateUserField allows clearing WhatsApp number (empty string)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // UPDATE query
      .mockResolvedValueOnce({ // findUserById query
        rows: [{ user_id: '12345678', whatsapp: '', nama: 'Test User' }] 
      });

    const result = await updateUserField('12345678', 'whatsapp', '');
    expect(result.user_id).toBe('12345678');
  });

  test('updateUserField allows clearing WhatsApp number (null)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // UPDATE query
      .mockResolvedValueOnce({ // findUserById query
        rows: [{ user_id: '12345678', whatsapp: null, nama: 'Test User' }] 
      });

    const result = await updateUserField('12345678', 'whatsapp', null);
    expect(result.user_id).toBe('12345678');
  });
});
