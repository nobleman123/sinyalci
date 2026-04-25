import { connectDB, disconnectDB } from './db/prisma';
import { redis } from './services/cache.service';
import { logger } from './utils/logger';
import { startMarketHealthWorker } from './workers/marketHealth.worker';
import { startSymbolUniverseWorker } from './workers/symbolUniverse.worker';
import { startSignalScannerWorker } from './workers/signalScanner.worker';
import { startOutcomeEvaluatorWorker } from './workers/outcomeEvaluator.worker';

async function bootstrapWorkers() {
  await connectDB();

  startMarketHealthWorker();
  startSymbolUniverseWorker();
  startSignalScannerWorker();
  startOutcomeEvaluatorWorker();

  logger.info('Worker runtime started');
}

async function shutdown() {
  logger.info('Worker shutting down...');
  await disconnectDB();
  await redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

bootstrapWorkers().catch((err: any) => {
  logger.error('Failed to start worker runtime', { error: err.message, stack: err.stack });
  process.exit(1);
});
