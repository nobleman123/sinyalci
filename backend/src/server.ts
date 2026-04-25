import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env';
import { connectDB, disconnectDB } from './db/prisma';
import { redis } from './services/cache.service';
import { logger } from './utils/logger';

// Routes
import { deviceRoutes }    from './routes/device.routes';
import { pushRoutes }      from './routes/push.routes';
import { settingsRoutes }  from './routes/settings.routes';
import { watchlistRoutes } from './routes/watchlist.routes';
import { marketRoutes }    from './routes/market.routes';
import { analyzeRoutes }   from './routes/analyze.routes';
import { signalRoutes }    from './routes/signals.routes';
import { analyticsRoutes } from './routes/analytics.routes';

// Workers — inlined so single Render process runs everything
import { startMarketHealthWorker }     from './workers/marketHealth.worker';
import { startSymbolUniverseWorker }   from './workers/symbolUniverse.worker';
import { startSignalScannerWorker }    from './workers/signalScanner.worker';
import { startOutcomeEvaluatorWorker } from './workers/outcomeEvaluator.worker';

const fastify = Fastify({
  logger: false,
  trustProxy: true,
});

async function bootstrap() {
  // ── CORS ─────────────────────────────────────────────────────────────
  // FIX: tüm olası frontend origin'leri kapsıyoruz; env.FRONTEND_ORIGIN
  //      ne olursa olsun sinyalci-frontend.onrender.com her zaman izinli.
  const allowedOrigins = [
    env.FRONTEND_ORIGIN,
    'https://sinyalci-frontend.onrender.com',
    'https://sinyalci.com',
    'https://www.sinyalci.com',
    'https://sinyalci-crypto-2026.web.app',
    'https://sinyalci-crypto-2026.firebaseapp.com',
    'http://localhost:3000',
    'http://localhost:5173',
  ].filter(Boolean);

  await fastify.register(cors, {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // mobile / curl / same-origin
      if (allowedOrigins.includes(origin)) return callback(null, true);
      logger.warn(`CORS blocked: ${origin}`);
      callback(new Error(`CORS: origin not allowed: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await fastify.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: 'Too many requests', statusCode: 429 }),
  });

  // ── Health check ──────────────────────────────────────────────────────
  fastify.get('/health', async () => ({
    status: 'ok',
    version: '7.1.0',
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
    workers: 'inline',
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

  // ── DB connect ────────────────────────────────────────────────────────
  await connectDB();

  // ── Start server ──────────────────────────────────────────────────────
  await fastify.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info(`🚀 NEXUS Backend v7.1 running on port ${env.PORT}`);

  // ── Inline Workers ────────────────────────────────────────────────────
  // FIX: Worker ayrı Render servisi yerine aynı process içinde çalışıyor.
  //      Ücretsiz planda tek servis ayakta kalır → cron job'lar çalışır.
  try {
    startMarketHealthWorker();
    startSymbolUniverseWorker();
    startSignalScannerWorker();
    startOutcomeEvaluatorWorker();
    logger.info('⚡ All inline workers started');
  } catch (err: any) {
    logger.error('Worker startup error (non-fatal)', { error: err.message });
  }

  // ── Keep-alive (Render Free Tier Sleep Prevention) ────────────────────
  if (env.NODE_ENV === 'production') {
    const BACKEND_URL =
      process.env.RENDER_EXTERNAL_URL || 'https://sinyalci-backend.onrender.com';
    let failCount = 0;

    async function keepAlive() {
      try {
        const res = await fetch(`${BACKEND_URL}/health`, {
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          failCount = 0;
          logger.info(`💓 Keep-alive OK [${new Date().toISOString()}]`);
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err: any) {
        failCount++;
        logger.warn(`⚠️ Keep-alive failed (${failCount}x)`, { error: err.message });
        if (failCount <= 3) setTimeout(keepAlive, 30_000);
      }
    }

    setInterval(keepAlive, 4 * 60 * 1000); // her 4 dakikada bir
    setTimeout(keepAlive, 15_000);          // boot'tan 15sn sonra ilk ping
    logger.info(`🔋 Keep-alive started (every 4m) → ${BACKEND_URL}`);
  }
}

// ── Graceful shutdown ──────────────────────────────────────────────────────
async function shutdown() {
  logger.info('Shutting down...');
  await fastify.close();
  await disconnectDB();
  await redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

bootstrap().catch(err => {
  logger.error('Failed to start server', { error: err.message, stack: err.stack });
  process.exit(1);
});
