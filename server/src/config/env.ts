import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  CORS_ORIGIN: z.string().default('http://localhost:4200'),
  PUBLIC_APP_URL: z.string().default('http://localhost:4200'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.string().optional().default('false'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  MAIL_FROM: z.string().default('NÉA STUDIO <no-reply@example.com>'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(''),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_TEMPLATE_NAME: z.string().optional().default(''),
  WHATSAPP_TEMPLATE_LANG: z.string().default('fr'),
  JOBS_ENABLED: z.string().default('true'),
  REMINDER_HOURS_BEFORE: z.coerce.number().default(24),
  // Vercel deployment
  CRON_SECRET: z.string().optional().default(''), // Vercel sends it as "Authorization: Bearer <CRON_SECRET>" on cron calls
  BLOB_READ_WRITE_TOKEN: z.string().optional().default(''), // Vercel Blob storage for uploaded images
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // throw (not process.exit) so a serverless function reports the cause in its logs
  const fields = Object.keys(parsed.error.flatten().fieldErrors).join(', ');
  throw new Error(`Invalid environment configuration — check: ${fields}`);
}
export const env = parsed.data;
export const isTest = env.NODE_ENV === 'test';
/** true when running on Vercel (set automatically by the platform) */
export const isVercel = !!process.env.VERCEL;
