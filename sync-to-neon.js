import dotenv from 'dotenv';
import pg from 'pg';

const { Client } = pg;

dotenv.config();

const {
  DATABASE_URL,
  DATABASE_BACKUP_URL,
  SYNC_INTERVAL_MS = '60000',
  SYNC_BATCH_SIZE = '500',
  SYNC_LOOKBACK_MINUTES = '5',
} = process.env;

if (!DATABASE_URL || !DATABASE_BACKUP_URL) {
  console.error('DATABASE_URL dan DATABASE_BACKUP_URL wajib di-set di environment.');
  process.exit(1);
}

const syncIntervalMs = Number(SYNC_INTERVAL_MS);
const syncBatchSize = Number(SYNC_BATCH_SIZE);
const syncLookbackMinutes = Number(SYNC_LOOKBACK_MINUTES);

if (!Number.isFinite(syncIntervalMs) || syncIntervalMs <= 0) {
  console.error('SYNC_INTERVAL_MS harus berupa angka positif.');
  process.exit(1);
}

if (!Number.isFinite(syncBatchSize) || syncBatchSize <= 0) {
  console.error('SYNC_BATCH_SIZE harus berupa angka positif.');
  process.exit(1);
}

if (!Number.isFinite(syncLookbackMinutes) || syncLookbackMinutes < 0) {
  console.error('SYNC_LOOKBACK_MINUTES harus berupa angka >= 0.');
  process.exit(1);
}

const local = new Client({
  connectionString: DATABASE_URL,
});

const neon = new Client({
  connectionString: DATABASE_BACKUP_URL,
  ssl: { rejectUnauthorized: false },
});

let isShuttingDown = false;
let syncInProgress = false;
let cursorCreatedAt = new Date(Date.now() - syncLookbackMinutes * 60 * 1000);
let cursorShortcode = '';

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function upsertToNeon(row) {
  await neon.query(
    `INSERT INTO insta_post (
      shortcode,
      client_id,
      caption,
      comment_count,
      thumbnail_url,
      is_video,
      video_url,
      image_url,
      images_url,
      is_carousel,
      created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (shortcode) DO UPDATE
    SET client_id = EXCLUDED.client_id,
        caption = EXCLUDED.caption,
        comment_count = EXCLUDED.comment_count,
        thumbnail_url = EXCLUDED.thumbnail_url,
        is_video = EXCLUDED.is_video,
        video_url = EXCLUDED.video_url,
        image_url = EXCLUDED.image_url,
        images_url = EXCLUDED.images_url,
        is_carousel = EXCLUDED.is_carousel,
        created_at = EXCLUDED.created_at`,
    [
      row.shortcode,
      row.client_id,
      row.caption,
      row.comment_count,
      row.thumbnail_url,
      row.is_video,
      row.video_url,
      row.image_url,
      row.images_url,
      row.is_carousel,
      row.created_at,
    ],
  );
}

async function syncBatch() {
  const { rows } = await local.query(
    `SELECT
      shortcode,
      client_id,
      caption,
      comment_count,
      thumbnail_url,
      is_video,
      video_url,
      image_url,
      images_url,
      is_carousel,
      created_at
    FROM insta_post
    WHERE created_at IS NOT NULL
      AND (
        created_at > $1
        OR (created_at = $1 AND shortcode > $2)
      )
    ORDER BY created_at ASC, shortcode ASC
    LIMIT $3`,
    [cursorCreatedAt, cursorShortcode, syncBatchSize],
  );

  if (rows.length === 0) {
    return 0;
  }

  for (const row of rows) {
    await upsertToNeon(row);
    cursorCreatedAt = row.created_at;
    cursorShortcode = row.shortcode;
  }

  return rows.length;
}

async function syncLoop() {
  if (syncInProgress) {
    return;
  }

  syncInProgress = true;

  try {
    let syncedRows = 0;
    do {
      syncedRows = await syncBatch();
      if (syncedRows > 0) {
        console.log(
          `[sync-to-neon] ${new Date().toISOString()} synced ${syncedRows} row(s). cursor=${cursorCreatedAt.toISOString()}|${cursorShortcode}`,
        );
      }
    } while (syncedRows === syncBatchSize && !isShuttingDown);
  } catch (error) {
    console.error('[sync-to-neon] Sync gagal:', error.message);
  } finally {
    syncInProgress = false;
  }
}

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`[sync-to-neon] Menerima ${signal}, menutup koneksi...`);

  await Promise.allSettled([local.end(), neon.end()]);
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

await local.connect();
await neon.connect();

console.log('[sync-to-neon] Koneksi local dan Neon berhasil.');
console.log(
  `[sync-to-neon] interval=${syncIntervalMs}ms batch=${syncBatchSize} lookback=${syncLookbackMinutes}m`,
);

while (!isShuttingDown) {
  await syncLoop();
  await sleep(syncIntervalMs);
}
