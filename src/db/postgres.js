import pkg from 'pg';
import { env } from '../config/env.js';
const { Pool } = pkg;

function assertSafeTestDatabase() {
  if (process.env.NODE_ENV !== 'test') return;

  const databaseName = String(env.DB_NAME || '').toLowerCase();
  const isExplicitTestDatabase = /(^test($|_)|_test($|_))/.test(databaseName);
  if (!isExplicitTestDatabase) {
    throw new Error(
      `Blocked PostgreSQL access from test environment to non-test database: ${databaseName || '(unset)'}`
    );
  }
}

const pool = new Pool({
  user: env.DB_USER,
  host: env.DB_HOST,
  database: env.DB_NAME,
  password: env.DB_PASS,
  port: env.DB_PORT,
  options: '-c timezone=Asia/Jakarta',
});

export const query = (text, params) => {
  assertSafeTestDatabase();
  return pool.query(text, params);
};
export const getClient = () => {
  assertSafeTestDatabase();
  return pool.connect();
};
export const close = () => pool.end();
export const getPool = () => pool;
