import { jest } from '@jest/globals';

const mockQuery = jest.fn();
jest.unstable_mockModule('../src/db/index.js', () => ({
  query: mockQuery,
}));

let findByClientId;
let getPostsByClientAndDateRange;
let upsertInstaPost;
beforeAll(async () => {
  ({
    findByClientId,
    getPostsByClientAndDateRange,
    upsertInstaPost,
  } = await import('../src/model/instaPostKhususModel.js'));
});

test('upsertInstaPost converts ISO assignment time to Jakarta wall clock', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await upsertInstaPost({
    client_id: 'KEDIRI',
    shortcode: 'abc123',
    created_at: '2026-09-11T23:54:42.571Z',
  });
  const [sql] = mockQuery.mock.calls[0];
  expect(sql).toContain("$13::timestamptz AT TIME ZONE 'Asia/Jakarta'");
});

beforeEach(() => {
  mockQuery.mockReset();
});

test('findByClientId uses DISTINCT ON to avoid duplicates', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await findByClientId('c1');
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('DISTINCT ON (shortcode)'),
    ['c1']
  );
});

test('getPostsByClientAndDateRange supports days option', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await getPostsByClientAndDateRange('c1', { days: 7 });
  const sql = mockQuery.mock.calls[0][0];
  expect(sql).toContain("created_at >= (NOW() AT TIME ZONE 'Asia/Jakarta') - INTERVAL '7 days'");
  expect(mockQuery.mock.calls[0][1]).toEqual(['c1']);
});

test('getPostsByClientAndDateRange supports start and end dates', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await getPostsByClientAndDateRange('c1', {
    startDate: '2024-01-01',
    endDate: '2024-01-31',
  });
  const sql = mockQuery.mock.calls[0][0];
  expect(sql).toContain('created_at::date >= $2');
  expect(sql).toContain('created_at::date <= $3');
  expect(mockQuery.mock.calls[0][1]).toEqual([
    'c1',
    '2024-01-01',
    '2024-01-31',
  ]);
});
