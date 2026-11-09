#!/usr/bin/env node
/**
 * Safe Prisma Migrate runner for the Neon (production) database.
 *
 *   npm run db:neon:status   → prisma migrate status   (read-only)
 *   npm run db:neon:deploy   → prisma migrate deploy   (applies pending migrations, asks for confirmation)
 *
 * Safety rules:
 *  - Reads connection strings EXCLUSIVELY from server/.env.neon (never from .env or the shell).
 *  - Refuses placeholders, non-Neon hosts, swapped pooled/direct URLs, or URLs pointing to different databases.
 *  - Only "migrate status" and "migrate deploy" are possible — never reset / db push.
 *  - Never prints passwords.
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
const ALLOWED = { status: ['migrate', 'status'], deploy: ['migrate', 'deploy'] };

const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

if (!ALLOWED[action]) fail('Usage: node scripts/neon-migrate.mjs <status|deploy>');
if (!existsSync(envFile)) fail('server/.env.neon not found. Copy server/.env.neon.example to server/.env.neon and paste your Neon URLs.');

// parse only this file — nothing is merged from .env or process.env
const vars = dotenv.parse(readFileSync(envFile));
const parseUrl = (name) => {
  const raw = vars[name];
  if (!raw) fail(`${name} is missing in server/.env.neon`);
  if (/[<>]/.test(raw)) fail(`${name} still contains a placeholder (<...>). Paste the real value from the Neon console.`);
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

if (!pooled.hostname.endsWith('.neon.tech') || !direct.hostname.endsWith('.neon.tech')) fail('Both hosts must be Neon hosts (*.neon.tech). Refusing to run against another server.');
if (!pooled.hostname.includes('-pooler')) fail('DATABASE_URL must be the POOLED connection (host contains "-pooler").');
if (direct.hostname.includes('-pooler')) fail('DIRECT_URL must be the DIRECT connection (host WITHOUT "-pooler").');
if (pooled.hostname.replace('-pooler', '') !== direct.hostname) fail('DATABASE_URL and DIRECT_URL point to different Neon endpoints.');
if (pooled.pathname !== direct.pathname || pooled.username !== direct.username) fail('DATABASE_URL and DIRECT_URL use a different database or user.');

const safe = (u) => `${u.username}@${u.hostname}${u.pathname}`; // no password
console.log(`Target (Neon)  : ${safe(direct)}`);
console.log(`Command        : prisma ${ALLOWED[action].join(' ')}`);

if (action === 'deploy') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('\nThis applies pending migrations to the PRODUCTION database. Type DEPLOY to continue: ');
  rl.close();
  if (answer.trim() !== 'DEPLOY') fail('Cancelled — nothing was changed.');
}

// Explicit variables take precedence over anything Prisma would read from server/.env
const result = spawnSync('npx', ['prisma', ...ALLOWED[action]], {
  cwd: serverDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: vars.DATABASE_URL, DIRECT_URL: vars.DIRECT_URL },
});
process.exit(result.status ?? 1);
