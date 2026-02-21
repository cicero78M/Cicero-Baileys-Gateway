import 'dotenv/config';
import { startNeonSyncCronJob } from './src/service/neonSyncService.js';

let syncJob = null;

async function shutdown() {
  console.log('[sync-to-neon] Shutting down sync process...');

  if (syncJob) {
    await syncJob.stop();
    syncJob = null;
  }

  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown().catch((error) => {
    console.error('[sync-to-neon] Failed to shutdown cleanly:', error);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown().catch((error) => {
    console.error('[sync-to-neon] Failed to shutdown cleanly:', error);
    process.exit(1);
  });
});

startNeonSyncCronJob()
  .then((job) => {
    syncJob = job;
  })
  .catch((error) => {
    console.error('[sync-to-neon] Fatal startup error:', error);
    process.exit(1);
  });
