import { FastifyPluginAsync } from 'fastify';
import { getMarketHealth, refreshMarketHealth } from '../services/marketHealth.service';
import { fetchAllTickers } from '../services/binance.service';
import { redis, CacheKey, TTL } from '../services/cache.service';
import { prisma } from '../db/prisma';

export const marketRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/market/health
  fastify.get('/health', async () => {
    const health = await getMarketHealth();
    return health;
  });

  // GET /api/market/regime
  fastify.get('/regime', async () => {
    const health = await getMarketHealth();
    return { regime: health.marketRegime, score: health.regimeScore, updatedAt: health.updatedAt };
  });

  // GET /api/market/symbols
  fastify.get('/symbols', async () => {
    const symbols = await prisma.coinMetadata.findMany({
      where:   { isActive: true },
      orderBy: { quoteVolume: 'desc' },
      select:  { symbol: true, baseAsset: true, name: true, marketCapRank: true, quoteVolume: true },
    });
    return { symbols };
  });

  // GET /api/market/top?limit=100
  fastify.get<{ Querystring: { limit?: string } }>('/top', async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '50'), 200);
    const cached = await redis.get<any[]>(CacheKey.tickerAll());
    if (cached) return { items: cached.slice(0, limit) };

    const tickers = await fetchAllTickers();
    const items = tickers.slice(0, limit).map(t => ({
      symbol:     t.symbol,
      price:      parseFloat(t.lastPrice),
      chgPct:     parseFloat(t.priceChangePercent),
      volume:     parseFloat(t.quoteVolume),
      high:       parseFloat(t.highPrice),
      low:        parseFloat(t.lowPrice),
    }));

    await redis.set(CacheKey.tickerAll(), items, TTL.ticker);
    return { items };
  });
};
