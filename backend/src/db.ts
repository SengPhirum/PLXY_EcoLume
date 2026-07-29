import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error', error);
});

export async function query<T extends pg.QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, values);
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function initializeDatabase(): Promise<void> {
  const schemaPath = path.resolve('migrations/001_initial.sql');
  const sql = await fs.readFile(schemaPath, 'utf8');
  await pool.query(sql);
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
