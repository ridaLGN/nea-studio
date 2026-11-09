import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { Prisma } from '@prisma/client';
import { env } from './config/env.js';
import { AppError, logger, isOverlapViolation, prisma } from './lib/core.js';
import { optionalAuth } from './middleware/auth.js';
import { publicRouter } from './routes/public.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { meRouter } from './routes/me.routes.js';
import { staffRouter } from './routes/staff.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { manageRouter, UPLOAD_DIR } from './routes/manage.routes.js';
import { analyticsRouter } from './routes/analytics.routes.js';
import { runJobsOnce } from './modules/notifications/jobs.js';
import { timingSafeEqual } from 'node:crypto';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  if (env.NODE_ENV !== 'test') app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  // Health check including the database, so "API up but database down" is visible immediately
  app.get('/api/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: 'up', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ ok: false, db: 'down', time: new Date().toISOString() });
    }
  });

  // Scheduled jobs (reminders, reward expiry). Locally they run on a timer (src/index.ts);
  // on Vercel there is no long-running process, so a Vercel Cron calls this route instead.
  app.get('/api/cron/jobs', async (req, res) => {
    if (!env.CRON_SECRET) return res.status(503).json({ error: { code: 'CRON_NOT_CONFIGURED', message: 'CRON_SECRET is not set' } });
    const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
    const given = Buffer.from(req.headers.authorization ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret' } });
    res.json({ ok: true, ...(await runJobsOnce()) });
  });
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', fallthrough: false }));

  app.use('/api/public', optionalAuth, publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/staff', staffRouter);
  app.use('/api/admin/analytics', analyticsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/admin', manageRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (isOverlapViolation(err)) return res.status(409).json({ error: { code: 'SLOT_UNAVAILABLE', message: 'This time slot was just taken. Please choose another one.' } });
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'This record already exists' } });
      if (err.code === 'P2025') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
      if (err.code === 'P2003') return res.status(409).json({ error: { code: 'IN_USE', message: 'This record is referenced by other data' } });
    }
    if ((err as { type?: string })?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
    logger.error({ err, url: req.url }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'An unexpected error occurred' } });
  });
  return app;
}
