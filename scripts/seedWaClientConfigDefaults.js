#!/usr/bin/env node

import { getPool, close } from '../src/db/postgres.js';
import { seedWaClientConfigDefaults } from '../src/service/waClientConfigDefaults.js';

async function main() {
  const overwrite = process.argv.includes('--overwrite');
  const pool = getPool();

  try {
    const seededCount = await seedWaClientConfigDefaults(pool, { overwrite });
    console.log(JSON.stringify({ seededCount, overwrite }, null, 2));
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
