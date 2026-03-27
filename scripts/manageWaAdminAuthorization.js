#!/usr/bin/env node

import {
  createAuthorization,
  revokeAuthorization,
  deleteAuthorization,
  setClientAccessScope,
  getAllAuthorizations,
  getAuthorizationStats
} from '../src/repository/administratorAuthorizationRepository.js';
import { getPool, close } from '../src/db/postgres.js';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const pool = getPool();

  try {
    switch (command) {
      case 'list': {
        const rows = await getAllAuthorizations(pool);
        console.log(JSON.stringify(rows, null, 2));
        break;
      }

      case 'stats': {
        const stats = await getAuthorizationStats(pool);
        console.log(JSON.stringify(stats, null, 2));
        break;
      }

      case 'grant': {
        const [phoneNumber, permissionLevel = 'full', ...clientIds] = args;
        if (!phoneNumber) {
          throw new Error('Usage: node scripts/manageWaAdminAuthorization.js grant <phoneNumber> [permissionLevel] [clientIds...]');
        }
        const created = await createAuthorization(pool, phoneNumber, {
          permissionLevel,
          clientAccessScope: clientIds
        });
        console.log(JSON.stringify(created, null, 2));
        break;
      }

      case 'revoke': {
        const [phoneNumber] = args;
        if (!phoneNumber) {
          throw new Error('Usage: node scripts/manageWaAdminAuthorization.js revoke <phoneNumber>');
        }
        const revoked = await revokeAuthorization(pool, phoneNumber);
        console.log(JSON.stringify({ phoneNumber, revoked }, null, 2));
        break;
      }

      case 'delete': {
        const [phoneNumber] = args;
        if (!phoneNumber) {
          throw new Error('Usage: node scripts/manageWaAdminAuthorization.js delete <phoneNumber>');
        }
        const deleted = await deleteAuthorization(pool, phoneNumber);
        console.log(JSON.stringify({ phoneNumber, deleted }, null, 2));
        break;
      }

      case 'scope': {
        const [phoneNumber, ...clientIds] = args;
        if (!phoneNumber || clientIds.length === 0) {
          throw new Error('Usage: node scripts/manageWaAdminAuthorization.js scope <phoneNumber> <clientId...>');
        }
        const updated = await setClientAccessScope(pool, phoneNumber, clientIds);
        console.log(JSON.stringify(updated, null, 2));
        break;
      }

      default:
        throw new Error(
          'Usage: node scripts/manageWaAdminAuthorization.js <list|stats|grant|revoke|delete|scope> ...'
        );
    }
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
