import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL is required.'); process.exit(1); }
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
const pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined, max: 1, connectionTimeoutMillis: 10000 });
try {
  console.log('Applying PostgreSQL schema...');
  await pool.query(schema);
  console.log('PostgreSQL schema applied successfully.');
} catch (error) {
  console.error('Failed to apply PostgreSQL schema:', error);
  process.exitCode = 1;
} finally { await pool.end(); }
