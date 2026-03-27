import { jest } from '@jest/globals';

const auditRepositoryMocks = {
  getAuditLogsByClient: jest.fn(),
  getAuditLogsByPhoneNumber: jest.fn(),
  getAuditStatistics: jest.fn(),
  getMostActiveAdministrators: jest.fn(),
  getMostModifiedConfigs: jest.fn()
};

await jest.unstable_mockModule('../src/repository/configurationAuditLogRepository.js', () => ({
  ...auditRepositoryMocks
}));

const {
  generateConfigurationAuditReport,
  formatConfigurationAuditReport
} = await import('../src/utils/configAuditReport.js');

describe('configAuditReport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auditRepositoryMocks.getAuditStatistics.mockResolvedValue({
      total_actions: 12,
      total_sessions: 4,
      affected_clients: 2,
      active_administrators: 2,
      total_modifications: 8,
      confirmed_sessions: 3,
      rolled_back_sessions: 1
    });
    auditRepositoryMocks.getMostActiveAdministrators.mockResolvedValue([
      { phone_number: '+6281234567890', total_actions: 7 }
    ]);
    auditRepositoryMocks.getMostModifiedConfigs.mockResolvedValue([
      { config_key: 'connection.host', modification_count: 4 }
    ]);
    auditRepositoryMocks.getAuditLogsByClient.mockResolvedValue([
      {
        created_at: '2026-03-27T10:00:00.000Z',
        action_type: 'modify_config',
        config_key: 'connection.host',
        phone_number: '+6281234567890'
      }
    ]);
    auditRepositoryMocks.getAuditLogsByPhoneNumber.mockResolvedValue([]);
  });

  test('should build a client-scoped audit report', async () => {
    const pool = { query: jest.fn() };
    const report = await generateConfigurationAuditReport(pool, {
      clientId: 'CLIENT_001',
      limit: 10
    });

    expect(auditRepositoryMocks.getAuditStatistics).toHaveBeenCalledWith(pool, {
      clientId: 'CLIENT_001',
      phoneNumber: null,
      dateFrom: null,
      dateTo: null
    });
    expect(auditRepositoryMocks.getAuditLogsByClient).toHaveBeenCalledWith(pool, 'CLIENT_001', {
      limit: 10,
      dateFrom: null,
      dateTo: null
    });
    expect(report.topConfigurations).toHaveLength(1);
  });

  test('should format the audit report into readable text', async () => {
    const pool = { query: jest.fn() };
    const report = await generateConfigurationAuditReport(pool, {
      clientId: 'CLIENT_001',
      limit: 10
    });

    const formatted = formatConfigurationAuditReport(report);

    expect(formatted).toContain('CONFIGURATION AUDIT REPORT');
    expect(formatted).toContain('Total Actions: 12');
    expect(formatted).toContain('connection.host');
    expect(formatted).toContain('+6281234567890');
  });
});
