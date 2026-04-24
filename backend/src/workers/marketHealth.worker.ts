import cron from 'node-cron';
import { refreshMarketHealth } from '../services/marketHealth.service';
import { logger } from '../utils/logger';

export function startMarketHealthWorker() {
  // Run immediately on start
  refreshMarketHealth().catch(err =>
    logger.error('Initial market health failed', { error: err.message })
  );

  // Every 5 minutes: */5 * * * *
  cron.schedule('*/5 * * * *', async () => {
    try {
      await refreshMarketHealth();
    } catch (err: any) {
      logger.error('Market health worker error', { error: err.message });
    }
  });

  logger.info('📡 Market Health Worker started (every 5m)');
}
