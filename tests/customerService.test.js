import { jest } from '@jest/globals';

const findEligibleCustomerByWhatsapp = jest.fn();
const recordCustomerServiceAudit = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../src/model/userModel.js', () => ({
  findEligibleCustomerByWhatsapp,
}));
jest.unstable_mockModule('../src/repository/complaintRepository.js', () => ({
  recordCustomerServiceAudit,
}));

const {
  authorizeCustomerServiceSender,
  handleCustomerServiceMessage,
} = await import('../src/service/customerService.js');

describe('customer service guard', () => {
  beforeEach(() => {
    findEligibleCustomerByWhatsapp.mockReset();
    recordCustomerServiceAudit.mockClear();
    delete process.env.GEMINI_API_KEY;
  });

  test('denies unknown sender before any LLM or send operation', async () => {
    findEligibleCustomerByWhatsapp.mockResolvedValue(null);
    const send = jest.fn();

    const result = await handleCustomerServiceMessage({
      text: 'Bagaimana cara login Cicero?',
      senderId: '628111111111@s.whatsapp.net',
      chatId: '628111111111@s.whatsapp.net',
      send,
    });

    expect(result.authorized).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(recordCustomerServiceAudit).toHaveBeenCalledWith(
      expect.objectContaining({ authorization: 'denied', intent: 'blocked' }),
      undefined,
    );
  });

  test('uses safe fallback for eligible FAQ when provider is not configured', async () => {
    findEligibleCustomerByWhatsapp.mockResolvedValue({ user_id: 'U1' });
    const send = jest.fn().mockResolvedValue(undefined);

    const result = await handleCustomerServiceMessage({
      text: 'Bagaimana cara login Cicero?',
      senderId: '628111111111@s.whatsapp.net',
      chatId: '628111111111@s.whatsapp.net',
      send,
    });

    expect(result.handled).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.stringContaining('operator Cicero'));
    expect(recordCustomerServiceAudit).toHaveBeenCalledWith(
      expect.objectContaining({ authorization: 'allowed', intent: 'faq', responseStatus: 'llm_unavailable' }),
      undefined,
    );
  });

  test('lets the existing deterministic pipeline handle an eligible complaint', async () => {
    findEligibleCustomerByWhatsapp.mockResolvedValue({ user_id: '123' });

    const result = await handleCustomerServiceMessage({
      text: 'Pesan Komplain\nNRP: 123\nKendala: like belum terbaca',
      senderId: '628111111111@s.whatsapp.net',
      chatId: '628111111111@s.whatsapp.net',
    });

    expect(result).toEqual(expect.objectContaining({ handled: false, authorized: true }));
  });

  test('blocks a complaint that names a different NRP', async () => {
    findEligibleCustomerByWhatsapp.mockResolvedValue({ user_id: '123' });

    const result = await handleCustomerServiceMessage({
      text: 'Pesan Komplain\nNRP: 999\nKendala: like belum terbaca',
      senderId: '628111111111@s.whatsapp.net',
      chatId: '628111111111111@s.whatsapp.net',
    });

    expect(result).toEqual(expect.objectContaining({ handled: true, authorized: false, identityMismatch: true }));
  });
});
