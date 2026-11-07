import { execSync } from 'node:child_process';
import { config } from 'dotenv';

export default function setup() {
  const env = config().parsed ?? {};
  const url = process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL;
  if (!url || !/test/i.test(url)) throw new Error('Refusing to run: TEST_DATABASE_URL must point to a database whose name contains "test"');
  // Apply pending migrations (non-destructive) to the dedicated test database; tests truncate tables themselves
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
}
