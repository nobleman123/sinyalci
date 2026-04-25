import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env';
import { connectDB, disconnectDB } from './db/prisma';
import { redis } from './services/cache.service';
import { logger } from './utils/logger';

// Routes
import { deviceRoutes }   from './routes/device.routes';
import { pushRoutes }     from './routes/push.routes';
import { settingsRoutes } from './routes/settings.routes';
import { watchlistRoutes }from './routes/watchlist.routes';
import { marketRoutes }   from './routes/market.routes';
import { analyzeRoutes }  from './routes/analyze.routes';
import { signalRoutes }   from './routes/signals.routes';
import { analyticsRoutes } from './routes/analytics.routes';

// Workers (background jobs)
import { startMarketHealthWorker }  from './workers/marketHealth.worker';
import { startSymbolUniverseWorker }from './workers/symbolUniverse.worker';
import { startSignalScannerWorker } from './workers/signalScanner.worker';
import { startOutcomeEvaluatorWorker } from './workers/outcomeEvaluator.worker';

const fastify = Fastify({
  logger: false,
  trustProxy: true,
});

async function bootstrap() {
  // ── Plugins ─────────────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: [
      env.FRONTEND_ORIGIN,
      'https://sinyalci.com',
      'https://www.sinyalci.com',
      'https://sinyalci-frontend.onrender.com',
      'http://localhost:3000',
      'http://localhost:5173',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await fastify.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: 'Too many requests', statusCode: 429 }),
  });

  // ── Health check ─────────────────────────────────────────────────────
  fastify.get('/health', async () => ({
    status: 'ok',
    version: '7.0.0',
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
  }));

  // ── API Routes ────────────────────────────────────────────────────────
  await fastify.register(deviceRoutes,    { prefix: '/api/device' });
  await fastify.register(pushRoutes,      { prefix: '/api/push' });
  await fastify.register(settingsRoutes,  { prefix: '/api/settings' });
  await fastify.register(watchlistRoutes, { prefix: '/api/watchlist' });
  await fastify.register(marketRoutes,    { prefix: '/api/market' });
  await fastify.register(analyzeRoutes,   { prefix: '/api/analyze' });
  await fastify.register(signalRoutes,    { prefix: '/api/signals' });
  await fastify.register(analyticsRoutes, { prefix: '/api/analytics' });

  // ── Error handler ─────────────────────────────────────────────────────
  fastify.setErrorHandler((err, _req, reply) => {
    logger.error('Request error', { error: err.message, stack: err.stack });
    reply.code(err.statusCode ?? 500).send({ error: err.message });
  });

  // ── DB + Redis connect ────────────────────────────────────────────────
  await connectDB();

  // ── Background workers ────────────────────────────────────────────────
  startMarketHealthWorker();
  startSymbolUniverseWorker();
  startSignalScannerWorker();
  startOutcomeEvaluatorWorker();

  // ── Start server ──────────────────────────────────────────────────────
  await fastify.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info(`🚀 NEXUS Backend running on port ${env.PORT}`);

  // ── Keep-alive (Prevent Render Free Tier Sleep) ────────────────────────
  if (env.NODE_ENV === 'production') {
    const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://sinyalci-backend.onrender.com';
    let failCount = 0;

    async function keepAlive() {
      try {
        const res = await fetch(`${BACKEND_URL}/health`);
        if (res.ok) {
          failCount = 0;
          logger.info(`💓 Keep-alive OK [${new Date().toISOString()}]`);
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err: any) {
        failCount++;
        logger.warn(`⚠️ Keep-alive ping failed (${failCount}x)`, { error: err.message });
        // Retry after 30 seconds if failed
        if (failCount <= 3) {
          setTimeout(keepAlive, 30_000);
        }
      }
    }

    // Ping every 4 minutes (Render sleeps after 15 min inactivity → 4 min is safe margin)
    setInterval(keepAlive, 4 * 60 * 1000);
    // Also do an immediate ping 10 seconds after boot
    setTimeout(keepAlive, 10_000);
    logger.info(`🔋 Keep-alive scheduler started (every 4m) → ${BACKEND_URL}`);
  }
}

// ── Graceful shutdown ────────────────────────────────────────────────────
async function shutdown() {
  logger.info('Shutting down...');
  await fastify.close();
  await disconnectDB();
  await redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

bootstrap().catch(err => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});
