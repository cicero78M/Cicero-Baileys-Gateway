import { jest } from '@jest/globals';

const mockGetConfigValueWithDefault = jest.fn();
const mockDbQuery = jest.fn();

jest.unstable_mockModule('../src/repository/clientConfigRepository.js', () => ({
  getConfigValueWithDefault: mockGetConfigValueWithDefault,
  setConfigValue: jest.fn(),
}));

jest.unstable_mockModule('../src/db/postgres.js', () => ({
  query: mockDbQuery,
}));

let getConfig, getConfigOrDefault, resolveClientIdForGroup, stopCacheEviction, clearCache;

beforeAll(async () => {
  ({
    getConfig,
    getConfigOrDefault,
    resolveClientIdForGroup,
    stopCacheEviction,
    clearCache,
  } = await import('../src/service/clientConfigService.js'));
});

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});

afterEach(() => {
  stopCacheEviction();
});

describe('getConfig — cache behavior', () => {
  test('calls DB on first fetch and caches result', async () => {
    mockGetConfigValueWithDefault.mockResolvedValue('pagi,siang,sore');

    const result = await getConfig('SATKER_A', 'broadcast_trigger_keywords');
    expect(result).toBe('pagi,siang,sore');
    expect(mockGetConfigValueWithDefault).toHaveBeenCalledTimes(1);
  });

  test('returns cached value on second call (no DB hit)', async () => {
    mockGetConfigValueWithDefault.mockResolvedValue('pagi,siang,sore');

    await getConfig('SATKER_A', 'broadcast_trigger_keywords');
    const cached = await getConfig('SATKER_A', 'broadcast_trigger_keywords');

    expect(cached).toBe('pagi,siang,sore');
    expect(mockGetConfigValueWithDefault).toHaveBeenCalledTimes(1);
  });

  test('re-fetches after TTL expiry', async () => {
    jest.useFakeTimers();

    mockGetConfigValueWithDefault
      .mockResolvedValueOnce('v1')
      .mockResolvedValueOnce('v2');

    const first = await getConfig('SATKER_A', 'some_key');
    expect(first).toBe('v1');

    jest.advanceTimersByTime(60_001);

    const second = await getConfig('SATKER_A', 'some_key');
    expect(second).toBe('v2');
    expect(mockGetConfigValueWithDefault).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  test('eviction sweep clears expired entries', async () => {
    jest.useFakeTimers();

    mockGetConfigValueWithDefault
      .mockResolvedValueOnce('old_val')
      .mockResolvedValueOnce('new_val');

    await getConfig('SATKER_A', 'some_key');

    // Advance past both TTL (60 s) and eviction interval (120 s)
    jest.advanceTimersByTime(120_001);

    // Cache should have been swept; next call re-fetches
    const result = await getConfig('SATKER_A', 'some_key');
    expect(result).toBe('new_val');
    expect(mockGetConfigValueWithDefault).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  test('caches null when DB returns null', async () => {
    mockGetConfigValueWithDefault.mockResolvedValue(null);
    const result = await getConfig('SATKER_X', 'missing_key');
    expect(result).toBeNull();
    expect(mockGetConfigValueWithDefault).toHaveBeenCalledTimes(1);
  });
});

describe('getConfigOrDefault', () => {
  test('returns DB value when found', async () => {
    mockGetConfigValueWithDefault.mockResolvedValue('db_value');
    const result = await getConfigOrDefault('SATKER_A', 'some_key', 'fallback');
    expect(result).toBe('db_value');
  });

  test('returns fallback when DB returns null', async () => {
    mockGetConfigValueWithDefault.mockResolvedValue(null);
    const result = await getConfigOrDefault('SATKER_A', 'missing', 'my_fallback');
    expect(result).toBe('my_fallback');
  });
});

describe('resolveClientIdForGroup', () => {
  test('returns client_id from client_config when found', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ client_id: 'SATKER_A' }] }); // client_config hit
    const result = await resolveClientIdForGroup('12345@g.us');
    expect(result).toBe('SATKER_A');
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
    expect(mockDbQuery.mock.calls[0][1]).toEqual(['12345@g.us']);
  });

  test('falls back to clients table when client_config has no match', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })                          // client_config miss
      .mockResolvedValueOnce({ rows: [{ client_id: 'SATKER_B' }] }); // clients hit
    const result = await resolveClientIdForGroup('99999@g.us');
    expect(result).toBe('SATKER_B');
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });

  test('returns null when neither table has the group JID', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await resolveClientIdForGroup('unknown@g.us');
    expect(result).toBeNull();
  });
});
