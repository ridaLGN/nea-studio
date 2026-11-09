#!/usr/bin/env node
/**
 * Guarded runner for the PRODUCTION seed (prisma/seed-production.ts) on Neon.
 *
 *   npm run db:neon:seed:plan   → read-only dry run: lists what would be created
 *   npm run db:neon:seed        → creates missing roles/permissions/settings (+ admin if PROD_ADMIN_* set; asks for confirmation)
 *
 * Safety rules:
 *  - Reads EXCLUSIVELY server/.env.neon (never .env or the shell) for the URLs and admin credentials.
 *  - Same URL checks as neon-migrate.mjs (Neon host, pooled vs direct, same database/user).
 *  - Apply mode requires typing the database name; the seed re-checks it (--confirm=<db>).
 *  - Uses the DIRECT connection (transaction-safe). Never prints passwords.
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(serverDir, '.env.neon');
const action = process.argv[2];

const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

if (action !== 'plan' && action !== 'apply') fail('Usage: node scripts/neon-seed.mjs <plan|apply>');
if (!existsSync(envFile)) fail('server/.env.neon not found. Copy server/.env.neon.example to server/.env.neon.');

const vars = dotenv.parse(readFileSync(envFile));
const parseUrl = (name) => {
  const raw = vars[name];
  if (!raw) fail(`${name} is missing in server/.env.neon`);
  if (/[<>]/.test(raw)) fail(`${name} still contains a placeholder (<...>).`);
  try {
    const u = new URL(raw);
    if (!/^postgres(ql)?:$/.test(u.protocol)) fail(`${name} must start with postgresql://`);
    return u;
  } catch {
    return fail(`${name} is not a valid connection URL`);
  }
};
const pooled = parseUrl('DATABASE_URL');
const direct = parseUrl('DIRECT_URL');
if (!pooled.hostname.endsWith('.neon.tech') || !direct.hostname.endsWith('.neon.tech')) fail('Both hosts must be Neon hosts (*.neon.tech).');
if (!pooled.hostname.includes('-pooler')) fail('DATABASE_URL must be the POOLED connection (host contains "-pooler").');
if (direct.hostname.includes('-pooler')) fail('DIRECT_URL must be the DIRECT connection (host WITHOUT "-pooler").');
if (pooled.hostname.replace('-pooler', '') !== direct.hostname) fail('DATABASE_URL and DIRECT_URL point to different Neon endpoints.');
if (pooled.pathname !== direct.pathname || pooled.username !== direct.username) fail('DATABASE_URL and DIRECT_URL use a different database or user.');

const dbName = decodeURIComponent(direct.pathname.replace(/^\//, ''));
const email = vars.PROD_ADMIN_EMAIL ?? '';
const password = vars.PROD_ADMIN_PASSWORD ?? '';
// Admin account is optional: both set → created, neither set → skipped, only one set → refused
if (Boolean(email) !== Boolean(password)) fail('Set BOTH PROD_ADMIN_EMAIL and PROD_ADMIN_PASSWORD in server/.env.neon, or NEITHER to skip the admin account.');

console.log(`Target (Neon)  : ${direct.username}@${direct.hostname}/${dbName}`);
console.log(`Admin account  : ${email ? email : 'not requested — skipped'}`);
console.log(`Action         : ${action === 'plan' ? 'dry run (read-only)' : 'APPLY production seed'}`);

if (action === 'apply') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nThis WRITES to the PRODUCTION database. Type the database name (${dbName}) to continue: `);
  rl.close();
  if (answer.trim() !== dbName) fail('Cancelled — nothing was changed.');
}

const seedArgs = ['tsx', 'prisma/seed-production.ts', `--confirm=${dbName}`, ...(action === 'plan' ? ['--dry-run'] : [])];
const result = spawnSync('npx', seedArgs, {
  cwd: serverDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  // Only what the seed needs; explicit values take precedence over anything Prisma would load from server/.env
  env: {
    ...process.env,
    DATABASE_URL: vars.DIRECT_URL,
    DIRECT_URL: vars.DIRECT_URL,
    PROD_ADMIN_EMAIL: email,
    PROD_ADMIN_PASSWORD: password,
    SEED_ADMIN_EMAIL: '',
    SEED_ADMIN_PASSWORD: '',
  },
});
process.exit(result.status ?? 1);
