import { CONFIG_GROUPS } from '../model/clientConfigModel.js';

export const WA_CLIENT_CONFIG_DEFAULTS = [
  {
    config_key: 'connection.host',
    config_value: 'gateway.example.com',
    description: 'Default gateway host name',
    config_group: CONFIG_GROUPS.CONNECTION,
    validation_pattern: '^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$'
  },
  {
    config_key: 'connection.port',
    config_value: '443',
    description: 'Default gateway port',
    config_group: CONFIG_GROUPS.CONNECTION,
    validation_pattern: '^([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$'
  },
  {
    config_key: 'connection.ssl_enabled',
    config_value: 'true',
    description: 'Enable SSL by default',
    config_group: CONFIG_GROUPS.CONNECTION,
    validation_pattern: '^(true|false)$'
  },
  {
    config_key: 'connection.timeout',
    config_value: '30000',
    description: 'Default timeout in milliseconds',
    config_group: CONFIG_GROUPS.CONNECTION,
    validation_pattern: '^[1-9][0-9]*$'
  },
  {
    config_key: 'message_handling.max_queue_size',
    config_value: '1000',
    description: 'Maximum queue size before backpressure',
    config_group: CONFIG_GROUPS.MESSAGE_HANDLING,
    validation_pattern: '^[1-9][0-9]*$'
  },
  {
    config_key: 'message_handling.retry_attempts',
    config_value: '3',
    description: 'Retry attempts for failed sends',
    config_group: CONFIG_GROUPS.MESSAGE_HANDLING,
    validation_pattern: '^(0|[1-9]|10)$'
  },
  {
    config_key: 'message_handling.rate_limit',
    config_value: '40/minute',
    description: 'Rate limit for outbound processing',
    config_group: CONFIG_GROUPS.MESSAGE_HANDLING,
    validation_pattern: '^[1-9][0-9]*\\/(second|minute|hour)$'
  },
  {
    config_key: 'notifications.status_alerts',
    config_value: 'true',
    description: 'Status alert notification toggle',
    config_group: CONFIG_GROUPS.NOTIFICATIONS,
    validation_pattern: '^(true|false)$'
  },
  {
    config_key: 'notifications.error_reports',
    config_value: 'true',
    description: 'Error report notification toggle',
    config_group: CONFIG_GROUPS.NOTIFICATIONS,
    validation_pattern: '^(true|false)$'
  },
  {
    config_key: 'notifications.daily_summary',
    config_value: 'false',
    description: 'Daily summary notification toggle',
    config_group: CONFIG_GROUPS.NOTIFICATIONS,
    validation_pattern: '^(true|false)$'
  },
  {
    config_key: 'automation_rules.auto_response',
    config_value: 'true',
    description: 'Automatic response processing toggle',
    config_group: CONFIG_GROUPS.AUTOMATION_RULES,
    validation_pattern: '^(true|false)$'
  },
  {
    config_key: 'automation_rules.complaint_processing',
    config_value: 'true',
    description: 'Complaint processing automation toggle',
    config_group: CONFIG_GROUPS.AUTOMATION_RULES,
    validation_pattern: '^(true|false)$'
  },
  {
    config_key: 'automation_rules.task_broadcasting',
    config_value: 'true',
    description: 'Task broadcasting automation toggle',
    config_group: CONFIG_GROUPS.AUTOMATION_RULES,
    validation_pattern: '^(true|false)$'
  }
];

export const WA_CLIENT_CONFIG_TEMPLATE_DEFAULTS = [
  {
    config_key: 'templates.client_list_header',
    config_value: '🔧 CLIENT CONFIGURATION MANAGEMENT\n\nAvailable active clients:',
    description: 'Header template for client selection list'
  },
  {
    config_key: 'templates.config_display_header',
    config_value: '📋 CURRENT CONFIGURATION',
    description: 'Header template for configuration overview'
  },
  {
    config_key: 'templates.modification_prompt',
    config_value: 'Would you like to modify any configuration settings? (yes/no)',
    description: 'Prompt template for modification confirmation'
  },
  {
    config_key: 'templates.group_selection_header',
    config_value: '🛠️ CONFIGURATION MODIFICATION\n\nWhich configuration group would you like to modify?',
    description: 'Header template for group selection'
  },
  {
    config_key: 'templates.changes_summary_header',
    config_value: '📝 CONFIGURATION CHANGES SUMMARY',
    description: 'Header template for change summary'
  }
].map((entry) => ({
  ...entry,
  config_group: 'templates',
  validation_pattern: null
}));

export async function seedWaClientConfigDefaults(pool, { overwrite = false } = {}) {
  const entries = [...WA_CLIENT_CONFIG_DEFAULTS, ...WA_CLIENT_CONFIG_TEMPLATE_DEFAULTS];
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const shouldRelease = typeof pool.connect === 'function';

  try {
    await client.query?.('BEGIN');

    for (const entry of entries) {
      if (overwrite) {
        await client.query(
          `INSERT INTO client_config (
             client_id, config_key, config_value, description, config_group, validation_pattern, created_at, updated_at
           ) VALUES ('DEFAULT', $1, $2, $3, $4, $5, NOW(), NOW())
           ON CONFLICT (client_id, config_key)
           DO UPDATE SET
             config_value = EXCLUDED.config_value,
             description = EXCLUDED.description,
             config_group = EXCLUDED.config_group,
             validation_pattern = EXCLUDED.validation_pattern,
             updated_at = NOW()`,
          [
            entry.config_key,
            entry.config_value,
            entry.description,
            entry.config_group,
            entry.validation_pattern
          ]
        );
        continue;
      }

      await client.query(
        `INSERT INTO client_config (
           client_id, config_key, config_value, description, config_group, validation_pattern, created_at, updated_at
         ) VALUES ('DEFAULT', $1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (client_id, config_key) DO NOTHING`,
        [
          entry.config_key,
          entry.config_value,
          entry.description,
          entry.config_group,
          entry.validation_pattern
        ]
      );
    }

    await client.query?.('COMMIT');
    return entries.length;
  } catch (error) {
    await client.query?.('ROLLBACK');
    throw error;
  } finally {
    if (shouldRelease) {
      client.release?.();
    }
  }
}
