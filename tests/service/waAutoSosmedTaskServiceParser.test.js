import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/service/sosmedBroadcastParser.js', () => ({
  isBroadcastMessage: jest.fn(),
  extractUrls: jest.fn().mockReturnValue({ igUrls: [], tiktokUrls: [] }),
  formatDate: jest.fn().mockReturnValue('Senin, 2 Juni 2025'),
}));

jest.unstable_mockModule('../../src/service/clientConfigService.js', () => ({
  resolveClientIdForGroup: jest.fn(),
  getConfig: jest.fn(),
  getConfigOrDefault: jest.fn().mockResolvedValue('ack'),
}));

jest.unstable_mockModule('../../src/repository/operatorRegistrationSessionRepository.js', () => ({
  findActiveSession: jest.fn().mockResolvedValue(null),
  upsertSession: jest.fn(),
  deleteSession: jest.fn(),
  isRateLimited: jest.fn(),
  purgeExpiredSessions: jest.fn(),
}));

jest.unstable_mockModule('../../src/repository/operatorRepository.js', () => ({
  findActiveOperatorByPhone: jest.fn().mockResolvedValue(null),
  upsertOperator: jest.fn(),
}));

jest.unstable_mockModule('../../src/service/operatorRegistrationService.js', () => ({
  handleUnregisteredBroadcast: jest.fn(),
  handleRegistrationDialog: jest.fn(),
}));

jest.unstable_mockModule('../../src/service/waOutbox.js', () => ({
  enqueueSend: jest.fn(),
}));

jest.unstable_mockModule('../../src/db/postgres.js', () => ({
  query: jest.fn(),
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.unstable_mockModule('../../src/handler/fetchpost/instaFetchPost.js', () => ({
  fetchSinglePostKhusus: jest.fn(),
}));

jest.unstable_mockModule('../../src/handler/fetchpost/tiktokFetchPost.js', () => ({
  fetchAndStoreSingleTiktokPost: jest.fn(),
}));

let cleanText;

beforeAll(async () => {
  ({ cleanText } = await import('../../src/service/waAutoSosmedTaskService.js'));
});

describe('waAutoSosmedTaskService  cleanText helper', () => {
  test('normalises escaped newline, zero-width chars', () => {
    const raw = 'Selamat sore\u200B komandan\\n follow';
    const result = cleanText(raw);
    expect(result).not.toContain('\u200B');
    expect(result).not.toContain('\\n');
  });

  test('returns empty string for null input', () => {
    expect(cleanText(null)).toBe('');
    expect(cleanText(undefined)).toBe('');
  });

  test('preserves regular alphanum text', () => {
    const result = cleanText('Selamat pagi 123');
    expect(result).toBe('Selamat pagi 123');
  });
});