import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { Prisma } from '@prisma/client';
import { env } from './config/env.js';
import { AppError, logger, isOverlapViolation } from './lib/core.js';
import { optionalAuth } from './middleware/auth.js';
import { publicRouter } from './routes/public.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { meRouter } from './routes/me.routes.js';
import { staffRouter } from './routes/staff.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { manageRouter, UPLOAD_DIR } from './routes/manage.routes.js';
import { analyticsRouter } from './routes/analytics.routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  if (env.NODE_ENV !== 'test') app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
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
