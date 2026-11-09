/**
 * Vercel entry point (serverless / Fluid compute).
 *
 * Vercel turns the default-exported Express app into a single Vercel Function.
 * Unlike src/index.ts (local / classic server), this file does NOT call listen(),
 * does not start the Socket.IO server and does not start interval timers:
 *  - HTTP serving is done by the platform,
 *  - scheduled jobs run through Vercel Cron → GET /api/cron/jobs,
 *  - live updates fall back to client polling (see GET /api/public/settings → "realtime").
 */
import { createApp } from './app.js';

const app = createApp();
export default app;
