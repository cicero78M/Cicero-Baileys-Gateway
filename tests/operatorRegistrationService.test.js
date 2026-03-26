import { jest } from '@jest/globals';

const mockFindActiveSession = jest.fn();
const mockUpsertSession = jest.fn();
const mockDeleteSession = jest.fn();
const mockIsRateLimited = jest.fn();
const mockFindActiveOperatorByPhone = jest.fn();
const mockUpsertOperator = jest.fn();
const mockGetConfig = jest.fn();
const mockEnqueueSend = jest.fn();
const mockReplayBroadcast = jest.fn();
const mockDbQuery = jest.fn();

jest.unstable_mockModule('../src/repository/operatorRegistrationSessionRepository.js', () => ({
  findActiveSession: mockFindActiveSession,
  upsertSession: mockUpsertSession,
  deleteSession: mockDeleteSession,
  isRateLimited: mockIsRateLimited,
  purgeExpiredSessions: jest.fn(),
}));

jest.unstable_mockModule('../src/repository/operatorRepository.js', () => ({
  findActiveOperatorByPhone: mockFindActiveOperatorByPhone,
  upsertOperator: mockUpsertOperator,
}));

jest.unstable_mockModule('../src/service/clientConfigService.js', () => ({
  getConfig: mockGetConfig,
  getConfigOrDefault: jest.fn(),
  resolveClientIdForGroup: jest.fn(),
  stopCacheEviction: jest.fn(),
  clearCache: jest.fn(),
}));

jest.unstable_mockModule('../src/db/postgres.js', () => ({
  query: mockDbQuery,
}));

let handleUnregisteredBroadcast, handleRegistrationDialog;

beforeAll(async () => {
  ({ handleUnregisteredBroadcast, handleRegistrationDialog } =
    await import('../src/service/operatorRegistrationService.js'));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockReplayBroadcast.mockResolvedValue(undefined);
  mockEnqueueSend.mockResolvedValue(undefined);
  mockUpsertSession.mockResolvedValue(undefined);
  mockUpsertOperator.mockResolvedValue(undefined);
  mockDeleteSession.mockResolvedValue(undefined);
});

// Default config values
function setupDefaultConfig() {
  mockGetConfig.mockImplementation((_clientId, key) => {
    const configMap = {
      operator_session_ttl_seconds: '3600',
      operator_registration_max_attempts: '3',
      operator_registration_cooldown_minutes: '60',
      operator_unregistered_prompt:
        'Anda mengirim pesan tugas untuk dieksekusi, tapi database kami belum membaca Satker Asal anda.\nApakah anda ingin mendaftarkan nomor anda sebagai operator tugas? (ya/tidak)',
      operator_satker_list_header: 'Pilih Satker Anda dengan membalas nomor urut:',
      operator_registration_ack: 'Nomor Anda berhasil terdaftar sebagai operator untuk {satker_name}.',
      operator_registration_declined: 'Baik, pendaftaran dibatalkan.',
      operator_invalid_choice: 'Pilihan tidak valid. Silakan balas dengan nomor urut.',
      operator_no_satker: 'Tidak ada Satker aktif. Hubungi administrator.',
    };
    return Promise.resolve(configMap[key] ?? null);
  });
}

// Satker list used in tests
const satkerRows = [
  { client_id: 'SATKER_A', nama: 'Polres A' },
  { client_id: 'SATKER_B', nama: 'Polres B' },
  { client_id: 'SATKER_C', nama: 'Dit. Intelkam' },
];

describe('handleUnregisteredBroadcast', () => {
  test('silently returns without enqueueSend when rate-limited', async () => {
    setupDefaultConfig();
    mockIsRateLimited.mockResolvedValue(true);

    await handleUnregisteredBroadcast('628111111111', 'raw msg', mockEnqueueSend);

    expect(mockEnqueueSend).not.toHaveBeenCalled();
    expect(mockUpsertSession).not.toHaveBeenCalled();
  });

  test('upserts session and sends Response D when not rate-limited', async () => {
    setupDefaultConfig();
    mockIsRateLimited.mockResolvedValue(false);

    await handleUnregisteredBroadcast('628111111111', 'raw msg', mockEnqueueSend);

    expect(mockUpsertSession).toHaveBeenCalledWith(
      expect.anything(),
      '628111111111',
      'awaiting_confirmation',
      'raw msg',
      3600,
      60
    );
    expect(mockEnqueueSend).toHaveBeenCalledTimes(1);
    const [jid, payload] = mockEnqueueSend.mock.calls[0];
    expect(jid).toBe('628111111111@s.whatsapp.net');
    expect(payload.text).toContain('Apakah anda ingin mendaftarkan');
  });
});

describe('handleRegistrationDialog — awaiting_confirmation stage', () => {
  const sessionBase = {
    phone_number: '628111111111',
    stage: 'awaiting_confirmation',
    original_message: 'Selamat pagi mohon izin dibantu like https://www.instagram.com/p/abc',
  };

  beforeEach(() => {
    setupDefaultConfig();
    mockFindActiveSession.mockResolvedValue({ ...sessionBase });
    mockDbQuery.mockResolvedValue({ rows: satkerRows });
  });

  const yaTokens = ['ya', 'iya', 'yes', 'y', 'ok', 'okay', 'setuju', 'benar', 'betul', 'daftar'];
  const tidakTokens = ['tidak', 'no', 'batal', 'cancel', 'n', 'stop', 'tolak'];

  // Test at least 2 ya-variants explicitly
  test.each(['ya', 'iya', 'yes', 'setuju'])(
    'ya-token "%s" advances stage to awaiting_satker_choice and sends Response E',
    async (token) => {
      await handleRegistrationDialog('628111111111', token, mockEnqueueSend, mockReplayBroadcast);

      expect(mockUpsertSession).toHaveBeenCalledWith(
        expect.anything(),
        '628111111111',
        'awaiting_satker_choice',
        sessionBase.original_message,
        3600,
        60
      );
      expect(mockEnqueueSend).toHaveBeenCalledTimes(1);
      const [jid, payload] = mockEnqueueSend.mock.calls[0];
      expect(jid).toBe('628111111111@s.whatsapp.net');
      expect(payload.text).toContain('Pilih Satker');
      expect(payload.text).toContain('1. Polres A');
      expect(payload.text).toContain('2. Polres B');
    }
  );

  // Test case-insensitivity for ya-token
  test('ya-token is case-insensitive (YA)', async () => {
    await handleRegistrationDialog('628111111111', 'YA', mockEnqueueSend, mockReplayBroadcast);
    expect(mockUpsertSession).toHaveBeenCalled();
    const [, { text }] = mockEnqueueSend.mock.calls[0];
    expect(text).toContain('Pilih Satker');
  });

  // Test at least 2 tidak-variants explicitly
  test.each(['tidak', 'batal', 'cancel', 'stop'])(
    'tidak-token "%s" deletes session and sends Response G',
    async (token) => {
      await handleRegistrationDialog('628111111111', token, mockEnqueueSend, mockReplayBroadcast);

      expect(mockDeleteSession).toHaveBeenCalledWith(expect.anything(), '628111111111');
      expect(mockEnqueueSend).toHaveBeenCalledTimes(1);
      const [jid, payload] = mockEnqueueSend.mock.calls[0];
      expect(jid).toBe('628111111111@s.whatsapp.net');
      expect(payload.text).toContain('pendaftaran dibatalkan');
      expect(mockUpsertOperator).not.toHaveBeenCalled();
    }
  );

  test('tidak-token is case-insensitive (TIDAK)', async () => {
    await handleRegistrationDialog('628111111111', 'TIDAK', mockEnqueueSend, mockReplayBroadcast);
    expect(mockDeleteSession).toHaveBeenCalled();
    expect(mockEnqueueSend.mock.calls[0][1].text).toContain('dibatalkan');
  });
});

describe('handleRegistrationDialog — awaiting_satker_choice stage', () => {
  const sessionBase = {
    phone_number: '628111111111',
    stage: 'awaiting_satker_choice',
    original_message: 'Selamat pagi mohon izin dibantu like https://www.instagram.com/p/abc',
  };

  beforeEach(() => {
    setupDefaultConfig();
    mockFindActiveSession.mockResolvedValue({ ...sessionBase });
    mockDbQuery.mockResolvedValue({ rows: satkerRows });
  });

  test('valid index 1 registers operator, deletes session, sends Response F, calls replayBroadcast', async () => {
    await handleRegistrationDialog('628111111111', '1', mockEnqueueSend, mockReplayBroadcast);

    expect(mockUpsertOperator).toHaveBeenCalledWith(
      expect.anything(),
      '628111111111',
      'SATKER_A',
      'Polres A'
    );
    expect(mockDeleteSession).toHaveBeenCalledWith(expect.anything(), '628111111111');
    expect(mockEnqueueSend).toHaveBeenCalledTimes(1);
    const [jid, payload] = mockEnqueueSend.mock.calls[0];
    expect(jid).toBe('628111111111@s.whatsapp.net');
    expect(payload.text).toContain('Polres A');
    expect(mockReplayBroadcast).toHaveBeenCalledWith(sessionBase.original_message);
  });

  test('valid index 3 registers operator with correct satker', async () => {
    await handleRegistrationDialog('628111111111', '3', mockEnqueueSend, mockReplayBroadcast);
    expect(mockUpsertOperator).toHaveBeenCalledWith(expect.anything(), '628111111111', 'SATKER_C', 'Dit. Intelkam');
  });

  test('invalid index sends Response H then resends Response E', async () => {
    await handleRegistrationDialog('628111111111', '99', mockEnqueueSend, mockReplayBroadcast);

    expect(mockUpsertOperator).not.toHaveBeenCalled();
    expect(mockDeleteSession).not.toHaveBeenCalled();
    expect(mockEnqueueSend).toHaveBeenCalledTimes(2);

    const texts = mockEnqueueSend.mock.calls.map(([, p]) => p.text);
    expect(texts[0]).toContain('Pilihan tidak valid');                 // Response H
    expect(texts[1]).toContain('Pilih Satker');                       // Response E
  });

  test('non-numeric reply sends Response H then resends Response E', async () => {
    await handleRegistrationDialog('628111111111', 'abc', mockEnqueueSend, mockReplayBroadcast);

    expect(mockEnqueueSend).toHaveBeenCalledTimes(2);
    expect(mockEnqueueSend.mock.calls[0][1].text).toContain('Pilihan tidak valid');
  });

  test('empty satker list sends Response I and does not upsert operator', async () => {
    mockDbQuery.mockResolvedValue({ rows: [] });

    await handleRegistrationDialog('628111111111', '1', mockEnqueueSend, mockReplayBroadcast);

    expect(mockUpsertOperator).not.toHaveBeenCalled();
    expect(mockEnqueueSend).toHaveBeenCalledTimes(1);
    expect(mockEnqueueSend.mock.calls[0][1].text).toContain('Tidak ada Satker aktif');
  });
});

describe('handleRegistrationDialog — no active session', () => {
  test('returns without action when no active session found', async () => {
    setupDefaultConfig();
    mockFindActiveSession.mockResolvedValue(null);

    await handleRegistrationDialog('628111111111', 'ya', mockEnqueueSend, mockReplayBroadcast);

    expect(mockEnqueueSend).not.toHaveBeenCalled();
    expect(mockUpsertOperator).not.toHaveBeenCalled();
  });
});
