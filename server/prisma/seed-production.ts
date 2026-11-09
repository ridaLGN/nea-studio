/**
 * NÉA STUDIO — PRODUCTION seed (Neon). Creates ONLY:
 *   - roles, permissions and role ↔ permission links
 *   - initial salon settings (row id = 1), opening hours, loyalty rules
 *   - OPTIONAL: one administrator account from PROD_ADMIN_EMAIL / PROD_ADMIN_PASSWORD
 *     (both unset → the admin step is skipped; only one of them set → refused, to avoid a half-configured run)
 * No demo data, no test accounts, no hard-coded passwords.
 *
 * Run it ONLY through the guarded runner (reads server/.env.neon, asks for confirmation):
 *   npm run db:neon:seed:plan   → read-only: shows what would be created, writes nothing
 *   npm run db:neon:seed        → applies it
 *
 * Idempotent and additive: it only creates what is missing. Existing rows are never updated or deleted
 * (an existing admin keeps its password, edited settings/hours/rules are left untouched).
 *
 * Safety checks (all before the first write):
 *   1. DATABASE_URL must be a Neon host (*.neon.tech) — local/Docker databases are refused.
 *   2. --confirm=<database name> must match the database in DATABASE_URL.
 *   3. Every migration in prisma/migrations must already be applied (and none failed).
 *   4. If an admin is requested: email/password must both be present, valid, strong, and not a known demo value.
 *   Everything is written in ONE transaction: on any error nothing is kept.
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSIONS, ROLE_PERMISSIONS, INITIAL_SETTINGS, INITIAL_OPENING_HOURS, INITIAL_LOYALTY_RULES } from './seed-data.js';

const fail = (msg: string): never => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

// ---------- 1. Read and validate inputs BEFORE creating any Prisma client ----------
// (Prisma auto-loads server/.env, which holds the local demo values — so we read our variables first,
//  use names that do not exist in .env, and pass the URL explicitly to the client.)
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const confirm = args.find((a) => a.startsWith('--confirm='))?.slice('--confirm='.length);

const rawUrl = process.env.DATABASE_URL ?? '';
const adminEmail = (process.env.PROD_ADMIN_EMAIL ?? '').trim().toLowerCase();
const adminPassword = process.env.PROD_ADMIN_PASSWORD ?? '';

let url: URL;
try {
  url = new URL(rawUrl);
} catch {
  fail('DATABASE_URL is missing or invalid. Run this seed with "npm run db:neon:seed[:plan]", never directly.');
}
const dbName = decodeURIComponent(url!.pathname.replace(/^\//, ''));
const target = `${url!.username}@${url!.hostname}/${dbName}`; // never the password

if (!/^postgres(ql)?:$/.test(url!.protocol)) fail('DATABASE_URL must be a postgresql:// URL.');
if (!url!.hostname.endsWith('.neon.tech')) fail(`Refusing: ${url!.hostname} is not a Neon host. This seed is for production only (use "npm run db:seed" locally).`);
if (!dbName) fail('DATABASE_URL has no database name.');
if (confirm !== dbName) fail(`Confirmation mismatch: pass --confirm=<database name> matching the target database.`);

// SHA-256 fingerprints of the development/test passwords used in seed.ts and tests/helpers.ts
// (stored as hashes so no password literal appears in this file). An admin password matching one is refused.
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const DEMO_PASSWORD_SHA256 = new Set([
  '5dc19806e8f480cde5d4b6ac55e34ee3d344046e8052d94a7ff96bf808d9ee35',
  '692ca1e84310d2c1305ca58bd316e277ebe678aa2bc595ed430a985442ed43bc',
  '02d55fa5540de6e2b43bbb0be183d0f066483bdb80880479da7434747f32fa08',
  '35559c13b6d7167cb053b83b48d60e008baaa4f7f4cc055fcd25dd306f8b3efa',
]);
const withAdmin = Boolean(adminEmail || adminPassword);
if (withAdmin) {
  if (!adminEmail || !adminPassword) fail('Set BOTH PROD_ADMIN_EMAIL and PROD_ADMIN_PASSWORD to create the administrator, or NEITHER to skip that step.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adminEmail)) fail('PROD_ADMIN_EMAIL is missing or not a valid email address.');
  if (/(\.demo|\.local|\.test|@example\.(com|org|net))$/.test(adminEmail)) fail('PROD_ADMIN_EMAIL is a demo/test address. Use a real mailbox you control.');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(adminPassword)).length;
  if (adminPassword.length < 14 || adminPassword.length > 128 || classes < 3)
    fail('PROD_ADMIN_PASSWORD must be 14–128 characters and mix at least 3 of: lowercase, uppercase, digits, symbols.');
  if (DEMO_PASSWORD_SHA256.has(sha256(adminPassword)) || /<|>|change.?me/i.test(adminPassword)) fail('PROD_ADMIN_PASSWORD is a demo or placeholder value.');
  if (adminPassword.toLowerCase().includes(adminEmail.split('@')[0])) fail('PROD_ADMIN_PASSWORD must not contain the email name.');
}

const prisma = new PrismaClient({ datasourceUrl: rawUrl });

// ---------- 2. Migration check (read-only) ----------
async function assertMigrationsApplied() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  const expected = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
    SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`.catch(() => fail('Table _prisma_migrations not found — migrations have not been applied to this database.'));
  const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
  if (failed.length) fail(`Unfinished/failed migrations: ${failed.join(', ')}. Fix them before seeding.`);
  const applied = new Set(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
  const missing = expected.filter((m) => !applied.has(m));
  if (missing.length) fail(`Pending migrations: ${missing.join(', ')}. Run "npm run db:neon:deploy" first.`);
  console.log(`Migrations     : ${expected.length}/${expected.length} applied`);
}

// ---------- 3. Plan: compute what is missing (read-only) ----------
async function plan() {
  const [perms, roles, links, settings, hours, ruleCount, admin, otherAdmins] = await Promise.all([
    prisma.permission.findMany({ select: { key: true } }),
    prisma.role.findMany({ select: { name: true } }),
    prisma.rolePermission.findMany({ select: { role: { select: { name: true } }, permission: { select: { key: true } } } }),
    prisma.salonSettings.findUnique({ where: { id: 1 }, select: { id: true } }),
    prisma.openingHour.findMany({ select: { weekday: true } }),
    prisma.loyaltyRule.count(),
    adminEmail ? prisma.user.findUnique({ where: { email: adminEmail }, select: { role: { select: { name: true } } } }) : null,
    prisma.user.count({ where: { role: { name: 'ADMIN' }, ...(adminEmail ? { email: { not: adminEmail } } : {}) } }),
  ]);
  const havePerm = new Set(perms.map((p) => p.key));
  const haveRole = new Set(roles.map((r) => r.name));
  const haveLink = new Set(links.map((l) => `${l.role.name}:${l.permission.key}`));
  const haveHour = new Set(hours.map((h) => h.weekday));
  if (admin && admin.role.name !== 'ADMIN') fail(`A user with PROD_ADMIN_EMAIL already exists with role ${admin.role.name}. Refusing to change it — choose another email.`);
  return {
    permissions: Object.keys(PERMISSIONS).filter((k) => !havePerm.has(k)),
    roles: Object.keys(ROLE_PERMISSIONS).filter((r) => !haveRole.has(r)),
    links: Object.entries(ROLE_PERMISSIONS).flatMap(([r, ps]) => ps.filter((p) => !haveLink.has(`${r}:${p}`)).map((p) => ({ role: r, perm: p }))),
    settings: !settings,
    openingHours: INITIAL_OPENING_HOURS.filter((h) => !haveHour.has(h.weekday)),
    loyaltyRules: ruleCount === 0,
    admin: Boolean(adminEmail) && !admin,
    adminExists: Boolean(admin),
    otherAdmins,
  };
}

function report(p: Awaited<ReturnType<typeof plan>>, verb: string) {
  const line = (label: string, n: number | boolean, extra = '') => console.log(`  ${label.padEnd(26)}: ${typeof n === 'boolean' ? (n ? verb : 'already present — skipped') : n ? `${n} ${verb}` : 'all present — skipped'}${extra}`);
  line('Permissions', p.permissions.length);
  line('Roles', p.roles.length);
  line('Role ↔ permission links', p.links.length);
  line('Salon settings (id 1)', p.settings);
  line('Opening hours', p.openingHours.length);
  line('Loyalty rules', p.loyaltyRules, p.loyaltyRules ? ` (${INITIAL_LOYALTY_RULES.length} rules)` : '');
  if (withAdmin) line('Administrator account', p.admin, p.adminExists ? ' (password NOT changed)' : '');
  else console.log(`  ${'Administrator account'.padEnd(26)}: skipped (PROD_ADMIN_EMAIL / PROD_ADMIN_PASSWORD not set)`);
  if (p.otherAdmins) console.log(`  ⚠ ${p.otherAdmins} ${withAdmin ? 'other ' : ''}ADMIN account(s) already exist in this database.`);
  else if (!withAdmin) console.log('  ℹ No ADMIN account exists yet: nobody can sign in to the back-office until one is created.');
}

// ---------- 4. Apply (single transaction, create-only) ----------
async function apply(p: Awaited<ReturnType<typeof plan>>) {
  const passwordHash = p.admin ? await bcrypt.hash(adminPassword, 12) : null;
  await prisma.$transaction(
    async (tx) => {
      if (p.permissions.length)
        await tx.permission.createMany({ data: p.permissions.map((key) => ({ key, description: PERMISSIONS[key] })), skipDuplicates: true });
      if (p.roles.length)
        await tx.role.createMany({ data: p.roles.map((name) => ({ name, description: `${name.toLowerCase()} role` })), skipDuplicates: true });
      if (p.links.length) {
        const [roles, perms] = await Promise.all([tx.role.findMany(), tx.permission.findMany()]);
        const roleId = new Map(roles.map((r) => [r.name, r.id]));
        const permId = new Map(perms.map((x) => [x.key, x.id]));
        await tx.rolePermission.createMany({ data: p.links.map((l) => ({ roleId: roleId.get(l.role)!, permissionId: permId.get(l.perm)! })), skipDuplicates: true });
      }
      if (p.settings) await tx.salonSettings.create({ data: { id: 1, ...INITIAL_SETTINGS } });
      if (p.openingHours.length) await tx.openingHour.createMany({ data: p.openingHours, skipDuplicates: true });
      if (p.loyaltyRules) await tx.loyaltyRule.createMany({ data: INITIAL_LOYALTY_RULES });
      if (passwordHash) {
        const adminRole = await tx.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
        await tx.user.create({ data: { email: adminEmail, passwordHash, roleId: adminRole.id } });
        await tx.auditLog.create({ data: { action: 'SEED_ADMIN_CREATED', entityType: 'User', details: { email: adminEmail, via: 'seed-production' } } });
      }
    },
    { timeout: 30_000 },
  );
}

async function main() {
  console.log(`Target (Neon)  : ${target}`);
  console.log(`Mode           : ${dryRun ? 'DRY RUN (read-only)' : 'APPLY'}`);
  await assertMigrationsApplied();
  const p = await plan();
  console.log(dryRun ? '\nWould create:' : '\nCreating:');
  report(p, dryRun ? 'to create' : 'created');
  if (dryRun) return console.log('\nDry run complete — nothing was written.');
  await apply(p);
  console.log('\n✔ Production seed complete.');
}

main()
  .catch((e) => {
    console.error('\n✖ Seed failed — the transaction was rolled back, nothing was written.');
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
