import cron from 'node-cron';
import { fetchAllTickers } from '../services/binance.service';
import { prisma } from '../db/prisma';
import { redis, CacheKey, TTL } from '../services/cache.service';
import { logger } from '../utils/logger';

async function refreshSymbolUniverse() {
  logger.info('Refreshing symbol universe...');
  const tickers = await fetchAllTickers();
  const top200 = tickers.slice(0, 200);

  // Upsert CoinMetadata for each symbol
  for (const t of top200) {
    const baseAsset = t.symbol.replace(/USDT$/, '');
    await prisma.coinMetadata.upsert({
      where:  { symbol: t.symbol },
      update: { quoteVolume: parseFloat(t.quoteVolume), isActive: true },
      create: { symbol: t.symbol, baseAsset, quoteVolume: parseFloat(t.quoteVolume), isActive: true },
    }).catch(() => {});
  }

  // Cache the universe list
  const universe = top200.map((t, i) => ({
    rank:   i + 1,
    symbol: t.symbol,
    price:  parseFloat(t.lastPrice),
    chgPct: parseFloat(t.priceChangePercent),
    volume: parseFloat(t.quoteVolume),
  }));

  await redis.set(CacheKey.symbolUniverse(), universe, TTL.symbolUniverse);
  logger.info(`Symbol universe updated: ${top200.length} coins`);
}

export function startSymbolUniverseWorker() {
  // Run immediately
  refreshSymbolUniverse().catch(err =>
    logger.error('Initial symbol universe failed', { error: err.message })
  );

  // Every 1 hour: 0 * * * *
  cron.schedule('0 * * * *', async () => {
    try {
      await refreshSymbolUniverse();
    } catch (err: any) {
      logger.error('Symbol universe worker error', { error: err.message });
    }
  });

  logger.info('🌐 Symbol Universe Worker started (every 1h)');
}
