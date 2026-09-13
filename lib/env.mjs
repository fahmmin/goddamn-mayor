/* Configuration, read once, shared by the serverless functions and the local
 * dev server.
 *
 * Deliberately tiny and dependency-free: the values here include a Postgres
 * URL that can do anything to the database, and a parser is a poor place to
 * take a dependency you have not read.
 *
 * .env is for local development only. On Vercel there is no such file and
 * there should not be - the same names are set as project environment
 * variables, and process.env already has them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, '.env');

if (fs.existsSync(FILE)) {
  for (const line of fs.readFileSync(FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_0-9]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

export const DATABASE_URL =
  (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL || '').trim();
export const PRIVY_APP_ID = (process.env.PRIVY_APP_ID || '').trim();
export const PORT = Number(process.env.CITY_API_PORT || 8787);

/* Which origin the browser may call from. Same-origin on Vercel, so nothing to
 * allow; a separate port in development, so everything to allow. */
export const ALLOWED_ORIGIN = (process.env.CITY_API_ORIGIN || 'http://localhost:8080').trim();

export function requireDb () {
  if (!DATABASE_URL) {
    console.error('\n  DATABASE_URL is not set - nothing to connect to.');
    console.error('  Locally: put it in .env. On Vercel: Project Settings -> Environment Variables.\n');
    process.exit(1);
  }
  return DATABASE_URL;
}
