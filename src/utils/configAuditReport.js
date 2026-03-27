import {
  getAuditLogsByClient,
  getAuditLogsByPhoneNumber,
  getAuditStatistics,
  getMostActiveAdministrators,
  getMostModifiedConfigs
} from '../repository/configurationAuditLogRepository.js';

export async function generateConfigurationAuditReport(pool, {
  clientId = null,
  phoneNumber = null,
  dateFrom = null,
  dateTo = null,
  limit = 20
} = {}) {
  const filters = { clientId, phoneNumber, dateFrom, dateTo };
  const stats = await getAuditStatistics(pool, filters);
  const topAdministrators = await getMostActiveAdministrators(pool, {
    limit: Math.min(limit, 10),
    dateFrom,
    dateTo
  });
  const topConfigurations = await getMostModifiedConfigs(pool, {
    limit,
    clientId,
    dateFrom,
    dateTo
  });

  let recentLogs = [];
  if (clientId) {
    recentLogs = await getAuditLogsByClient(pool, clientId, {
      limit,
      dateFrom,
      dateTo
    });
  } else if (phoneNumber) {
    recentLogs = await getAuditLogsByPhoneNumber(pool, phoneNumber, {
      limit,
      clientId,
      dateFrom,
      dateTo
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    filters,
    summary: stats,
    topAdministrators,
    topConfigurations,
    recentLogs
  };
}

export function formatConfigurationAuditReport(report) {
  const lines = [
    'CONFIGURATION AUDIT REPORT',
    `Generated At: ${report.generatedAt}`,
    `Client Filter: ${report.filters.clientId || 'ALL'}`,
    `Phone Filter: ${report.filters.phoneNumber || 'ALL'}`,
    ''
  ];

  if (report.summary) {
    lines.push('Summary:');
    lines.push(`- Total Actions: ${report.summary.total_actions ?? 0}`);
    lines.push(`- Total Sessions: ${report.summary.total_sessions ?? 0}`);
    lines.push(`- Affected Clients: ${report.summary.affected_clients ?? 0}`);
    lines.push(`- Active Administrators: ${report.summary.active_administrators ?? 0}`);
    lines.push(`- Total Modifications: ${report.summary.total_modifications ?? 0}`);
    lines.push(`- Confirmed Sessions: ${report.summary.confirmed_sessions ?? 0}`);
    lines.push(`- Rolled Back Sessions: ${report.summary.rolled_back_sessions ?? 0}`);
    lines.push('');
  }

  if (report.topAdministrators.length > 0) {
    lines.push('Most Active Administrators:');
    report.topAdministrators.forEach((administrator, index) => {
      lines.push(`${index + 1}. ${administrator.phone_number} - ${administrator.total_actions} actions`);
    });
    lines.push('');
  }

  if (report.topConfigurations.length > 0) {
    lines.push('Most Modified Configuration Keys:');
    report.topConfigurations.forEach((configuration, index) => {
      lines.push(`${index + 1}. ${configuration.config_key} - ${configuration.modification_count} changes`);
    });
    lines.push('');
  }

  if (report.recentLogs.length > 0) {
    lines.push('Recent Audit Entries:');
    report.recentLogs.forEach((log, index) => {
      lines.push(
        `${index + 1}. [${log.created_at}] ${log.action_type} ${log.config_key || '-'} ${log.phone_number || '-'}`
      );
    });
  }

  return lines.join('\n').trim();
}
