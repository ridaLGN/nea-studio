import http from 'node:http';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { initRealtime } from './lib/realtime.js';
import { logger, prisma } from './lib/core.js';
import { startJobs } from './modules/notifications/jobs.js';
import { providerStatus } from './modules/notifications/notifications.service.js';

const server = http.createServer(createApp());
initRealtime(server);
server.listen(env.PORT, () => {
  logger.info(`NÉA STUDIO API listening on http://localhost:${env.PORT}`);
  for (const p of providerStatus()) if (!p.configured) logger.warn(`${p.channel} notifications not configured — messages will be logged as NOT_CONFIGURED`);
  startJobs();
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
