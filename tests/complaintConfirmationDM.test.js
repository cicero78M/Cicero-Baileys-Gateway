/**
 * T021 — complaintConfirmationDM.test.js
 * Tests for handleConfirmationDM (T018): "ya konfirmasi ig/tiktok" DM reply flow
 */
import { jest } from '@jest/globals';

// Mock the repository (has DB chain)
jest.unstable_mockModule('../src/repository/complaintRepository.js', () => ({
  getUserByNrp: jest.fn(),
  getAuditCounts: jest.fn(),
  updateUserSocialHandle: jest.fn(),
  getLatestPost: jest.fn(),
}));

// Mock pendingConfirmationStore (in-memory but isolate for test control)
jest.unstable_mockModule('../src/service/pendingConfirmationStore.js', () => ({
  setConfirmation: jest.fn(),
  getConfirmation: jest.fn(),
  deleteConfirmation: jest.fn(),
  getConfirmationStoreStat: jest.fn(() => ({ size: 0, maxEntries: 1000 })),
}));

// Mock waOutbox enqueueSend
jest.unstable_mockModule('../src/service/waOutbox.js', () => ({
  enqueueSend: jest.fn(),
  attachWorker: jest.fn(),
}));

let handleConfirmationDM;
let mockUpdateUserSocialHandle;
let mockGetConfirmation;
let mockDeleteConfirmation;
let mockEnqueueSend;

beforeAll(async () => {
  const repo = await import('../src/repository/complaintRepository.js');
  mockUpdateUserSocialHandle = repo.updateUserSocialHandle;

  const store = await import('../src/service/pendingConfirmationStore.js');
  mockGetConfirmation = store.getConfirmation;
  mockDeleteConfirmation = store.deleteConfirmation;

  const outbox = await import('../src/service/waOutbox.js');
  mockEnqueueSend = outbox.enqueueSend;

  const svc = await import('../src/service/waAutoComplaintService.js');
  handleConfirmationDM = svc.handleConfirmationDM;
});

beforeEach(() => {
  jest.clearAllMocks();
});

function makeMsg(body, remoteJid = '628123456789@c.us') {
  return { body, key: { remoteJid } };
}

const activeSession = {
  senderJid: '628123456789@c.us',
  platform: 'instagram',
  oldUsername: 'old_ig',
  newUsername: 'new_ig',
  nrp: '75020201',
  expiresAt: Date.now() + 15 * 60 * 1000,
};

describe('handleConfirmationDM', () => {
  // (a) "ya konfirmasi ig" from DM with active session => DB updated + enqueueSend + deleteConfirmation
  test('(a) "ya konfirmasi ig" from DM with active session → DB updated, DM sent, session deleted', async () => {
    mockGetConfirmation.mockReturnValue(activeSession);
    mockUpdateUserSocialHandle.mockResolvedValue();

    const result = await handleConfirmationDM(makeMsg('ya konfirmasi ig'), '628123456789@c.us');

    expect(result).toBe(true);
    expect(mockUpdateUserSocialHandle).toHaveBeenCalledWith('75020201', 'instagram', 'new_ig');
    expect(mockEnqueueSend).toHaveBeenCalledWith(
      '628123456789@c.us',
      expect.objectContaining({ text: expect.stringContaining('new_ig') }),
    );
    expect(mockDeleteConfirmation).toHaveBeenCalledWith('628123456789@c.us', 'instagram');
  });

  // (b) "ya konfirmasi tiktok" => tiktok column updated
  test('(b) "ya konfirmasi tiktok" → tiktok platform updated', async () => {
    const tiktokSession = {
      ...activeSession,
      platform: 'tiktok',
      oldUsername: 'old_tt',
      newUsername: 'new_tt',
    };
    mockGetConfirmation.mockReturnValue(tiktokSession);
    mockUpdateUserSocialHandle.mockResolvedValue();

    const result = await handleConfirmationDM(makeMsg('ya konfirmasi tiktok'), '628123456789@c.us');

    expect(result).toBe(true);
    expect(mockUpdateUserSocialHandle).toHaveBeenCalledWith('75020201', 'tiktok', 'new_tt');
    expect(mockGetConfirmation).toHaveBeenCalledWith('628123456789@c.us', 'tiktok');
  });

  // (c) Message from group JID => return false, no DB call
  test('(c) Group JID message → return false, no DB call', async () => {
    const result = await handleConfirmationDM(makeMsg('ya konfirmasi ig', '120363000000@g.us'), '628123456789@c.us');

    expect(result).toBe(false);
    expect(mockUpdateUserSocialHandle).not.toHaveBeenCalled();
    expect(mockEnqueueSend).not.toHaveBeenCalled();
  });

  // (d) No active session for sender => return false, no DB call
  test('(d) No active confirmation session → return false, no DB call', async () => {
    mockGetConfirmation.mockReturnValue(null);

    const result = await handleConfirmationDM(makeMsg('ya konfirmasi ig'), '628123456789@c.us');

    expect(result).toBe(false);
    expect(mockUpdateUserSocialHandle).not.toHaveBeenCalled();
    expect(mockEnqueueSend).not.toHaveBeenCalled();
  });

  // (e) Expired session (getConfirmation returns null) => return false, no response
  test('(e) Expired session (getConfirmation returns null) → return false without response', async () => {
    mockGetConfirmation.mockReturnValue(null);

    const result = await handleConfirmationDM(makeMsg('ya konfirmasi tiktok'), '628123456789@c.us');

    expect(result).toBe(false);
    expect(mockEnqueueSend).not.toHaveBeenCalled();
    expect(mockDeleteConfirmation).not.toHaveBeenCalled();
  });

  // (f) Case-insensitive match "Ya Konfirmasi IG"
  test('(f) "Ya Konfirmasi IG" (uppercase) → case-insensitive match succeeds', async () => {
    mockGetConfirmation.mockReturnValue(activeSession);
    mockUpdateUserSocialHandle.mockResolvedValue();

    const result = await handleConfirmationDM(makeMsg('Ya Konfirmasi IG'), '628123456789@c.us');

    expect(result).toBe(true);
    expect(mockUpdateUserSocialHandle).toHaveBeenCalledWith('75020201', 'instagram', 'new_ig');
  });
});
