import { jest } from '@jest/globals';

const mockQuery = jest.fn();
const mockPool = { query: mockQuery };

jest.unstable_mockModule('../src/db/postgres.js', () => ({
  query: mockQuery,
  default: mockPool,
}));

let findActiveOperatorByPhone, upsertOperator;

beforeAll(async () => {
  ({ findActiveOperatorByPhone, upsertOperator } =
    await import('../src/repository/operatorRepository.js'));
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('findActiveOperatorByPhone', () => {
  test('returns row when operator found and is_active=TRUE', async () => {
    const row = {
      phone_number: '628123456789',
      client_id: 'SATKER_A',
      satker_name: 'Polres A',
      is_active: true,
    };
    mockQuery.mockResolvedValue({ rows: [row] });

    const result = await findActiveOperatorByPhone(mockPool, '628123456789');
    expect(result).toEqual(row);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('is_active = TRUE'),
      ['628123456789']
    );
  });

  test('returns null when operator not found', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await findActiveOperatorByPhone(mockPool, '628999999999');
    expect(result).toBeNull();
  });

  test('returns null when is_active=FALSE (query filters it out)', async () => {
    // The query only selects WHERE is_active=TRUE; inactive operators return no rows
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await findActiveOperatorByPhone(mockPool, '628000000000');
    expect(result).toBeNull();
    expect(mockQuery.mock.calls[0][0]).toContain('is_active = TRUE');
  });
});

describe('upsertOperator', () => {
  test('executes INSERT ON CONFLICT DO UPDATE with all columns', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    await upsertOperator(mockPool, '628123456789', 'SATKER_A', 'Polres A');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (phone_number)');
    expect(sql).toContain('DO UPDATE SET');
    expect(sql).toContain('client_id');
    expect(sql).toContain('satker_name');
    expect(sql).toContain('is_active = TRUE');
    expect(params).toEqual(['628123456789', 'SATKER_A', 'Polres A']);
  });

  test('updates existing operator with new satker assignment', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    await upsertOperator(mockPool, '628123456789', 'SATKER_B', 'Polres B');
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toContain('SATKER_B');
    expect(params).toContain('Polres B');
  });
});
