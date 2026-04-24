import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db/prisma';
import { fetchAllTickers, fetchKlines } from '../services/binance.service';
import { analyzeCandles, SignalResult } from '../services/signalEngine.service';
import { getMarketHealth } from '../services/marketHealth.service';
import { redis, CacheKey, TTL } from '../services/cache.service';
import { isValidTimeframe } from '../utils/timeframes';

export const signalRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/signals/latest?userId=...&limit=20
  fastify.get<{ Querystring: { userId?: string; limit?: string } }>('/latest', async (req) => {
    const { userId, limit = '20' } = req.query;
    const take = Math.min(parseInt(limit), 100);
    const signals = await prisma.signalEvent.findMany({
      where:   userId ? { userId } : {},
      orderBy: { createdAt: 'desc' },
      take,
    });
    return { signals };
  });

  // GET /api/signals/history?userId=...
  fastify.get<{ Querystring: { userId?: string; symbol?: string; limit?: string } }>(
    '/history', async (req) => {
      const { userId, symbol, limit = '50' } = req.query;
      const take = Math.min(parseInt(limit), 200);
      const signals = await prisma.signalEvent.findMany({
        where: {
          ...(userId ? { userId } : {}),
          ...(symbol ? { symbol: symbol.toUpperCase() } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take,
      });
      return { signals };
    }
  );

  // GET /api/signals/sleeping?userId=...&limit=5
  fastify.get<{ Querystring: { userId?: string; limit?: string; tf?: string } }>(
    '/sleeping', async (req) => {
      const { userId, limit = '5', tf = '1h' } = req.query;
      if (!isValidTimeframe(tf)) return { items: [] };

      const cacheKey = `sleeping:${tf}`;
      const cached = await redis.get<SignalResult[]>(cacheKey);
      if (cached) return { items: cached.slice(0, parseInt(limit)) };

      const health = await getMarketHealth();
      const tickers = await fetchAllTickers();
      const top50 = tickers.slice(0, 50);
      const sleeping: SignalResult[] = [];

      for (const ticker of top50) {
        if (sleeping.length >= 10) break;
        try {
          const candles = await fetchKlines(ticker.symbol, tf, 520);
          if (candles.length < 60) continue;
          const result = analyzeCandles(candles, ticker.symbol, tf, health.marketRegime);
          if (result.isSleeping && result.signal.includes('SLEEPING')) {
            sleeping.push(result);
          }
          await new Promise(r => setTimeout(r, 120));
        } catch {}
      }

      sleeping.sort((a, b) => b.confidence - a.confidence);
      await redis.set(cacheKey, sleeping, TTL.klines(tf));
      return { items: sleeping.slice(0, parseInt(limit)) };
    }
  );

  // POST /api/signals/scan-now
  fastify.post<{ Body: { userId?: string; symbols?: string[]; tf?: string } }>(
    '/scan-now', async (req, reply) => {
      const { userId, symbols, tf = '1h' } = req.body ?? {};
      if (!isValidTimeframe(tf)) return reply.code(400).send({ error: 'Invalid timeframe' });

      const health = await getMarketHealth();
      let toScan: string[];

      if (symbols && symbols.length > 0) {
        toScan = symbols.slice(0, 20).map(s => s.toUpperCase());
      } else {
        const tickers = await fetchAllTickers();
        toScan = tickers.slice(0, 50).map(t => t.symbol);
      }

      const results: SignalResult[] = [];
      for (const symbol of toScan) {
        try {
          const candles = await fetchKlines(symbol, tf, 520);
          if (candles.length < 60) continue;
          const r = analyzeCandles(candles, symbol, tf, health.marketRegime);
          results.push(r);
          await new Promise(res => setTimeout(res, 100));
        } catch {}
      }

      results.sort((a, b) => b.confidence - a.confidence);
      return { results, count: results.length, scanned: toScan.length };
    }
  );
};
