import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

const env = config().parsed ?? {};
const testDb = process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL;
if (!testDb) throw new Error('TEST_DATABASE_URL is required to run tests (it is wiped by the test suite)');

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    fileParallelism: false, // integration tests share one database
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { ...env, DATABASE_URL: testDb, NODE_ENV: 'test', JOBS_ENABLED: 'false', SMTP_HOST: '', WHATSAPP_ACCESS_TOKEN: '' },
  },
});
