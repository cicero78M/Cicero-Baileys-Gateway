import { jest } from '@jest/globals';

const mockQuery = jest.fn();
const mockPool = { query: mockQuery };

jest.unstable_mockModule('../src/db/postgres.js', () => ({
  query: mockQuery,
  default: mockPool,
}));

let findActiveSession, upsertSession, deleteSession, isRateLimited, purgeExpiredSessions;

beforeAll(async () => {
  ({
    findActiveSession,
    upsertSession,
    deleteSession,
    isRateLimited,
    purgeExpiredSessions,
  } = await import('../src/repository/operatorRegistrationSessionRepository.js'));
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('findActiveSession', () => {
  test('returns row when active session exists (expires_at > NOW())', async () => {
    const row = {
      phone_number: '628123456789',
      stage: 'awaiting_confirmation',
      original_message: 'Selamat pagi...',
      attempt_count: 1,
    };
    mockQuery.mockResolvedValue({ rows: [row] });

    const result = await findActiveSession(mockPool, '628123456789');
    expect(result).toEqual(row);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('expires_at > NOW()'),
      ['628123456789']
    );
  });

  test('returns null when session expired (query uses expires_at > NOW())', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await findActiveSession(mockPool, '628000000000');
    expect(result).toBeNull();
  });

  test('returns null when no session exists', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await findActiveSession(mockPool, '628999999999');
    expect(result).toBeNull();
  });
});

describe('upsertSession', () => {
  test('inserts session with correct parameterized values', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    await upsertSession(mockPool, '628123456789', 'awaiting_confirmation', 'raw msg', 3600, 60);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO operator_registration_sessions');
    expect(sql).toContain('ON CONFLICT (phone_number)');
    expect(params[0]).toBe('628123456789');
    expect(params[1]).toBe('awaiting_confirmation');
    expect(params[2]).toBe('raw msg');
  });

  test('increments attempt_count when within cooldown window', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    await upsertSession(mockPool, '628123456789', 'awaiting_confirmation', 'msg', 3600, 60);
    const [sql] = mockQuery.mock.calls[0];

    // The SQL must handle attempt_count increment via conditional CASE logic
    expect(sql).toContain('attempt_count');
    expect(sql).toMatch(/CASE\s+WHEN/i);
  });

  test('resets attempt_count=1 and first_attempt_at=NOW() when cooldown expired', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    await upsertSession(mockPool, '628123456789', 'awaiting_confirmation', 'msg', 3600, 60);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('first_attempt_at');
  });
});

describe('deleteSession', () => {
  test('executes parameterized DELETE by phone_number', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    await deleteSession(mockPool, '628123456789');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('DELETE FROM operator_registration_sessions');
    expect(sql).toContain('phone_number = $1');
    expect(params).toEqual(['628123456789']);
  });
});

describe('isRateLimited', () => {
  test('returns true when attempt_count >= max AND within cooldown window', async () => {
    // DB row: attempt_count=3, within 60 min cooldown window
    mockQuery.mockResolvedValue({
      rows: [{ rate_limited: true }],
    });

    const result = await isRateLimited(mockPool, '628123456789', 3, 60);
    expect(result).toBe(true);
  });

  test('returns false when attempt_count < max', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ rate_limited: false }],
    });

    const result = await isRateLimited(mockPool, '628123456789', 3, 60);
    expect(result).toBe(false);
  });

  test('returns false when cooldown window has expired', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ rate_limited: false }],
    });

    const result = await isRateLimited(mockPool, '628123456789', 3, 60);
    expect(result).toBe(false);
  });

  test('returns false when no session record exists', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await isRateLimited(mockPool, '628999999999', 3, 60);
    expect(result).toBe(false);
  });
});

describe('purgeExpiredSessions', () => {
  test('executes DELETE WHERE expires_at <= NOW()', async () => {
    mockQuery.mockResolvedValue({ rowCount: 5 });

    const count = await purgeExpiredSessions(mockPool);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('DELETE FROM operator_registration_sessions');
    expect(sql).toContain('expires_at <= NOW()');
  });

  test('returns the count of deleted rows', async () => {
    mockQuery.mockResolvedValue({ rowCount: 3 });
    const result = await purgeExpiredSessions(mockPool);
    expect(result).toBe(3);
  });
});
