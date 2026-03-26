import { jest } from '@jest/globals';

const mockQuery = jest.fn();
const mockPool = { query: mockQuery };

jest.unstable_mockModule('../src/db/postgres.js', () => ({
  query: mockQuery,
  default: mockPool,
}));

let getConfigValue, getConfigValueWithDefault, setConfigValue;

beforeAll(async () => {
  ({ getConfigValue, getConfigValueWithDefault, setConfigValue } =
    await import('../src/repository/clientConfigRepository.js'));
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getConfigValue', () => {
  test('returns config_value string when row found', async () => {
    mockQuery.mockResolvedValue({ rows: [{ config_value: 'pagi,siang' }] });
    const result = await getConfigValue(mockPool, 'SATKER_A', 'broadcast_trigger_keywords');
    expect(result).toBe('pagi,siang');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT config_value FROM client_config'),
      ['SATKER_A', 'broadcast_trigger_keywords']
    );
  });

  test('returns null when no row found', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await getConfigValue(mockPool, 'SATKER_A', 'nonexistent_key');
    expect(result).toBeNull();
  });
});

describe('getConfigValueWithDefault', () => {
  test('returns per-client value when found', async () => {
    mockQuery.mockResolvedValue({ rows: [{ config_value: 'custom_value' }] });
    const result = await getConfigValueWithDefault(mockPool, 'SATKER_A', 'broadcast_required_phrase');
    expect(result).toBe('custom_value');
  });

  test('falls back to DEFAULT client_id when per-client row absent', async () => {
    // Query returns the DEFAULT row
    mockQuery.mockResolvedValue({ rows: [{ config_value: 'mohon izin dibantu' }] });
    const result = await getConfigValueWithDefault(mockPool, 'SATKER_UNKNOWN', 'broadcast_required_phrase');
    expect(result).toBe('mohon izin dibantu');
    // Both client_id = SATKER_UNKNOWN and 'DEFAULT' are in the query
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("client_id = 'DEFAULT'");
    expect(params[0]).toBe('SATKER_UNKNOWN');
    expect(params[1]).toBe('broadcast_required_phrase');
  });

  test('returns null when neither per-client nor DEFAULT row exists', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await getConfigValueWithDefault(mockPool, 'SATKER_A', 'missing');
    expect(result).toBeNull();
  });
});

describe('setConfigValue', () => {
  test('executes parameterized upsert INSERT ... ON CONFLICT DO UPDATE', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    await setConfigValue(mockPool, 'SATKER_A', 'task_input_ack', 'Tugas direkam.');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (client_id, config_key)'),
      ['SATKER_A', 'task_input_ack', 'Tugas direkam.']
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DO UPDATE SET config_value'),
      expect.any(Array)
    );
  });
});
