import { jest } from '@jest/globals';

const mockQuery = jest.fn();

jest.unstable_mockModule('../src/db/index.js', () => ({ query: mockQuery }));

const { absensiRegistrasiDashboardDirektorat } = await import(
  '../src/handler/fetchabsensi/dashboard/absensiRegistrasiDashboardDirektorat.js'
);

beforeEach(() => {
  mockQuery.mockClear();
});

test('normalizes ORG/Org/org via SQL filter and builds ORG recap', async () => {
  mockQuery.mockImplementation((sql) => {
    if (sql.includes('FROM roles')) return { rows: [{ role_id: 10 }] };
    if (sql.includes('FROM clients') && sql.includes('LIMIT 1')) {
      return {
        rows: [{ client_id: 'DITINTELKAM', nama: 'Direktorat Intelkam', client_type: 'direktorat' }],
      };
    }
    if (sql.includes("LOWER(TRIM(COALESCE(client_type, ''))) = $1")) {
      return {
        rows: [
          { client_id: 'org_a', nama: 'Org A', client_type: 'ORG' },
          { client_id: 'ORG_B', nama: 'Org B', client_type: 'Org' },
        ],
      };
    }
    if (sql.includes('LOWER(TRIM(client_type)) = $1')) {
      return {
        rows: [{ client_id: 'ORG_PARENT', nama: 'Org Parent', client_type: 'org' }],
      };
    }
    if (sql.includes('COUNT(DISTINCT du.dashboard_user_id) AS operator') && sql.includes('= $2')) {
      return { rows: [{ operator: 1 }] };
    }
    if (sql.includes('AS dashboard_user') && sql.includes('ANY($2)')) {
      return {
        rows: [
          { client_id: 'ORG_A', dashboard_user: 1 },
          { client_id: 'ORG_B', dashboard_user: 2 },
        ],
      };
    }
    if (sql.includes('AS operator') && sql.includes('ANY($2)')) {
      return {
        rows: [{ client_id: 'ORG_B', operator: 1 }],
      };
    }
    return { rows: [] };
  });

  const msg = await absensiRegistrasiDashboardDirektorat('DITINTELKAM');

  expect(mockQuery).toHaveBeenNthCalledWith(
    3,
    expect.stringContaining('LOWER(TRIM(client_type)) = $1'),
    ['org']
  );
  expect(mockQuery.mock.calls[2][0]).not.toContain('client_status = true');
  expect(mockQuery).toHaveBeenNthCalledWith(
    6,
    expect.stringContaining('AS dashboard_user'),
    ['ditintelkam', ['ORG_A', 'ORG_B']]
  );
  expect(msg).toMatch(/DIREKTORAT INTELKAM : 3 Direktorat \(1 absensi web\)/);
  expect(msg).toMatch(/- ORG A : 1 user dashboard \(0 absensi web\)/);
  expect(msg).toMatch(/- ORG B : 2 user dashboard \(1 absensi web\)/);
});

test('uses dedicated directorate query (no ORG fallback in directorate count)', async () => {
  mockQuery.mockImplementation((sql) => {
    if (sql.includes('FROM roles')) return { rows: [{ role_id: 1 }] };
    if (sql.includes('FROM clients') && sql.includes('LIMIT 1')) {
      return { rows: [{ client_id: 'DITBINMAS', nama: 'Direktorat Binmas', client_type: 'direktorat' }] };
    }
    if (sql.includes('LIMIT 1')) {
      return {
        rows: [
          {
            client_id: 'CUSTOM_DIT',
            nama: 'Custom Dit',
            client_type: 'direktorat',
            regional_id: 'JATIM',
            client_level: 2,
          },
        ],
      };
    }
    if (sql.includes('LOWER(TRIM(client_type)) = $1')) {
      return {
        rows: [{ client_id: 'ORG_JATIM', nama: 'Org Jatim', client_type: 'org' }],
      };
    }
    if (sql.includes('AS dashboard_user')) {
      return {
        rows: [{ client_id: 'CUSTOM_DIT', dashboard_user: 1 }],
      };
    }
    if (sql.includes('COUNT(DISTINCT du.dashboard_user_id) AS operator') && sql.includes('= $2')) {
      return { rows: [{ operator: 0 }] };
    }
    return { rows: [] };
  });

  await absensiRegistrasiDashboardDirektorat('DITBINMAS');

  expect(mockQuery).toHaveBeenNthCalledWith(
    4,
    expect.stringContaining('COUNT(DISTINCT du.dashboard_user_id) AS dashboard_user'),
    ['ditbinmas', 'DITBINMAS']
  );
  expect(mockQuery).toHaveBeenNthCalledWith(
    5,
    expect.stringContaining('COUNT(DISTINCT du.dashboard_user_id) AS operator'),
    ['ditbinmas', 'DITBINMAS', expect.any(Date)]
  );
  expect(mockQuery).toHaveBeenCalledTimes(5);
});

test('fails fast when directorate role mapping is missing', async () => {
  await expect(absensiRegistrasiDashboardDirektorat('CUSTOM_DIT')).rejects.toThrow(
    'Role mapping untuk client Direktorat "CUSTOM_DIT" belum terdaftar.'
  );
  expect(mockQuery).toHaveBeenCalledTimes(0);
});

test('fails fast when mapped role is missing from roles table', async () => {
  mockQuery.mockResolvedValue({ rows: [] });

  await expect(absensiRegistrasiDashboardDirektorat('DITLANTAS')).rejects.toThrow(
    'Konfigurasi role belum sinkron antara mapping aplikasi dan database.'
  );

  expect(mockQuery).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining('FROM roles'),
    ['ditlantas']
  );
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('fails fast when selected client_id is not found in clients table', async () => {
  mockQuery.mockImplementation((sql) => {
    if (sql.includes('FROM roles') && sql.includes('LIMIT 1')) {
      return {
        rows: [{ role_id: 1 }],
      };
    }
    if (sql.includes('LIMIT 1')) {
      return {
        rows: [
          {
            client_id: 'DITBINMAS',
            nama: 'Direktorat Binmas',
            client_type: 'direktorat',
            regional_id: 'JATIM',
            client_level: 2,
          },
        ],
      };
    }
    if (sql.includes('LOWER(TRIM(client_type)) = $1')) {
      return {
        rows: [{ client_id: 'ORG_JATIM', nama: 'Org Jatim', client_type: 'org' }],
      };
    }
    if (sql.includes('AS dashboard_user')) {
      return {
        rows: [{ client_id: 'DITBINMAS', dashboard_user: 1 }],
      };
    }
    if (sql.includes('JOIN login_log ll')) {
      return {
        rows: [],
      };
    }
    return { rows: [] };
  });

  await absensiRegistrasiDashboardDirektorat('DITBINMAS');

  expect(mockQuery).toHaveBeenNthCalledWith(
    3,
    expect.stringContaining('LOWER(TRIM(client_type)) = $1'),
    ['org']
  );
  expect(mockQuery).toHaveBeenNthCalledWith(
    4,
    expect.stringContaining('AS dashboard_user'),
    ['ditbinmas', ['DITBINMAS', 'ORG_JATIM']]
  );
});

test('fails fast when selected client is not tipe direktorat', async () => {
  mockQuery.mockImplementation((sql) => {
    if (sql.includes('FROM roles')) return { rows: [{ role_id: 6 }] };
    if (sql.includes('FROM clients') && sql.includes('LIMIT 1')) {
      return { rows: [{ client_id: 'DITBINMAS', nama: 'Dit Binmas', client_type: 'org' }] };
    }
    return { rows: [] };
  });

  await expect(absensiRegistrasiDashboardDirektorat('DITBINMAS')).rejects.toThrow(
    'Client "DITBINMAS" bukan tipe direktorat'
  );
});

test('keeps zero-state ORG sections with dash marker', async () => {
  mockQuery.mockImplementation((sql) => {
    if (sql.includes('FROM roles')) return { rows: [{ role_id: 2 }] };
    if (sql.includes('FROM clients') && sql.includes('LIMIT 1')) {
      return { rows: [{ client_id: 'DITLANTAS', nama: 'Direktorat Lantas', client_type: 'direktorat' }] };
    }
    if (sql.includes('LOWER(TRIM(client_type)) = $1')) {
      return { rows: [] };
    }
    if (sql.includes('COUNT(DISTINCT du.dashboard_user_id) AS operator') && sql.includes('= $2')) {
      return { rows: [{ operator: 2 }] };
    }
    return { rows: [] };
  });

  const msg = await absensiRegistrasiDashboardDirektorat('DITLANTAS');

  expect(msg).toMatch(/Sudah memiliki user dashboard : 0 client ORG/);
  expect(msg).toMatch(/Belum memiliki user dashboard : 0 client ORG\n-/);
});

test('directorate metadata validation line is present', async () => {
  mockQuery.mockImplementation((sql) => {
    if (sql.includes('FROM roles') && sql.includes('LIMIT 1')) {
      return {
        rows: [{ role_id: 3 }],
      };
    }
    if (sql.includes('LIMIT 1')) {
      return {
        rows: [
          {
            client_id: 'DITSAMAPTA',
            nama: 'Direktorat Samapta',
            client_type: 'direktorat',
            regional_id: 'JATIM',
            client_level: 'direktorat',
          },
        ],
      };
    }
    if (sql.includes('LOWER(TRIM(client_type)) = $1')) {
      return {
        rows: [
          {
            client_id: 'SATKER_SAMAPTA_1',
            nama: 'Satker Samapta 1',
            client_type: 'ORG',
            client_level: 'Satker',
          },
        ],
      };
    }
    if (sql.includes("LOWER(TRIM(COALESCE(client_type, ''))) = $1")) return { rows: [] };
    if (sql.includes('COUNT(DISTINCT du.dashboard_user_id) AS dashboard_user') && sql.includes('= $2')) {
      return { rows: [{ dashboard_user: 0 }] };
    }
    if (sql.includes('COUNT(DISTINCT du.dashboard_user_id) AS operator') && sql.includes('= $2')) {
      return { rows: [{ operator: 0 }] };
    }
    return { rows: [] };
  });

  const msg = await absensiRegistrasiDashboardDirektorat('DITLANTAS');

  expect(mockQuery).toHaveBeenNthCalledWith(
    3,
    expect.stringContaining('LOWER(TRIM(client_type)) = $1'),
    ['org']
  );
  expect(mockQuery).toHaveBeenNthCalledWith(
    4,
    expect.stringContaining('AS dashboard_user'),
    ['ditsamapta', ['DITSAMAPTA', 'SATKER_SAMAPTA_1']]
  );
});

test('fails fast when selected client_id is not found in clients table', async () => {
  mockQuery.mockImplementation((sql) => {
    if (sql.includes('FROM roles') && sql.includes('LIMIT 1')) {
      return { rows: [{ role_id: 5 }] };
    }
    if (sql.includes('FROM clients') && sql.includes('LIMIT 1')) {
      return { rows: [] };
    }
    return { rows: [] };
  });

  await expect(absensiRegistrasiDashboardDirektorat('DITBINMAS')).rejects.toThrow(
    'Client Direktorat "DITBINMAS" tidak ditemukan pada tabel clients.'
  );

  expect(mockQuery).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining('FROM clients'),
    ['DITBINMAS']
  );
});

test('fails fast when selected client is not tipe direktorat', async () => {
  mockQuery.mockImplementation((sql) => {
    if (sql.includes('FROM roles') && sql.includes('LIMIT 1')) {
      return { rows: [{ role_id: 6 }] };
    }
    if (sql.includes('FROM clients') && sql.includes('LIMIT 1')) {
      return {
        rows: [
          {
            client_id: 'DITBINMAS',
            nama: 'Dit Binmas',
            client_type: 'org',
            regional_id: 'JATIM',
            client_level: 'org',
          },
        ],
      };
    }
    return { rows: [] };
  });

  await expect(absensiRegistrasiDashboardDirektorat('DITBINMAS')).rejects.toThrow(
    'Client "DITBINMAS" bukan tipe direktorat'
  );
});
