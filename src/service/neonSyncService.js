import pkg from 'pg';

const { Client } = pkg;

function resolveRuntimeConfig(overrides = {}) {
  return {
    databaseUrl: overrides.databaseUrl || process.env.DATABASE_URL,
    databaseBackupUrl:
      overrides.databaseBackupUrl || process.env.DATABASE_BACKUP_URL,
    pollIntervalMs: Number(
      overrides.pollIntervalMs || process.env.NEON_SYNC_INTERVAL_MS || 3_600_000,
    ),
    syncWindowMinutes: Number(
      overrides.syncWindowMinutes || process.env.NEON_SYNC_WINDOW_MINUTES || 60,
    ),
  };
}

function validateRuntimeConfig(config) {
  const missingVars = [];
  if (!config.databaseUrl) missingVars.push('DATABASE_URL');
  if (!config.databaseBackupUrl) missingVars.push('DATABASE_BACKUP_URL');

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missingVars.join(', ')}`,
    );
  }

  if (!Number.isFinite(config.pollIntervalMs) || config.pollIntervalMs <= 0) {
    throw new Error('NEON_SYNC_INTERVAL_MS must be a positive number');
  }

  if (
    !Number.isFinite(config.syncWindowMinutes) ||
    config.syncWindowMinutes <= 0
  ) {
    throw new Error('NEON_SYNC_WINDOW_MINUTES must be a positive number');
  }
}

export function createNeonSyncJob(options = {}) {
  const logger = options.logger || console;
  const config = resolveRuntimeConfig(options);
  validateRuntimeConfig(config);

  const localClient = new Client({
    connectionString: config.databaseUrl,
  });

  const neonClient = new Client({
    connectionString: config.databaseBackupUrl,
    ssl: { rejectUnauthorized: false },
  });

  let intervalId = null;
  let isRunning = false;

  async function syncRecentInstaPosts() {
    if (isRunning) {
      logger.warn('[sync-to-neon] Previous sync is still running, skipping cycle.');
      return { syncedRows: 0, skipped: true };
    }

    isRunning = true;
    try {
      const query = `
        SELECT id, caption
        FROM insta_post
        WHERE created_at > NOW() - ($1 || ' minutes')::interval
      `;

      const { rows } = await localClient.query(query, [config.syncWindowMinutes]);

      for (const row of rows) {
        await neonClient.query(
          `
            INSERT INTO insta_post(id, caption)
            VALUES($1, $2)
            ON CONFLICT (id) DO UPDATE
            SET caption = EXCLUDED.caption
          `,
          [row.id, row.caption],
        );
      }

      logger.log(
        `[sync-to-neon] Synced ${rows.length} row(s) at ${new Date().toISOString()}`,
      );
      return { syncedRows: rows.length, skipped: false };
    } finally {
      isRunning = false;
    }
  }

  async function start() {
    await localClient.connect();
    await neonClient.connect();

    logger.log(
      `[sync-to-neon] Cron job active (interval=${config.pollIntervalMs}ms, window=${config.syncWindowMinutes} minute(s)).`,
    );

    await syncRecentInstaPosts();

    intervalId = setInterval(() => {
      syncRecentInstaPosts().catch((error) => {
        logger.error('[sync-to-neon] Sync cycle failed:', error);
      });
    }, config.pollIntervalMs);

    intervalId.unref?.();
  }

  async function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }

    await Promise.allSettled([localClient.end(), neonClient.end()]);
  }

  return {
    start,
    stop,
    syncRecentInstaPosts,
  };
}

export async function startNeonSyncCronJob(options = {}) {
  const logger = options.logger || console;
  const job = createNeonSyncJob(options);
  await job.start();
  return job;
}
