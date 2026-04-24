import { FastifyPluginAsync } from 'fastify';
import { fetchKlines } from '../services/binance.service';
import { redis, CacheKey, TTL } from '../services/cache.service';
import { analyzeCandles, SignalResult } from '../services/signalEngine.service';
import { getMarketHealth } from '../services/marketHealth.service';
import { isValidTimeframe } from '../utils/timeframes';

export const analyzeRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/analyze/:symbol?tf=1h
  fastify.get<{ Params: { symbol: string }; Querystring: { tf?: string } }>(
    '/:symbol', async (req, reply) => {
      const symbol = req.params.symbol.toUpperCase();
      const tf = req.query.tf ?? '1h';
      if (!isValidTimeframe(tf)) return reply.code(400).send({ error: 'Invalid timeframe' });

      const cacheKey = CacheKey.analysis(symbol, tf);
      const cached = await redis.get<SignalResult>(cacheKey);
      if (cached) return { ...cached, cached: true };

      const [candles, health] = await Promise.all([
        fetchKlines(symbol, tf, 520),
        getMarketHealth(),
      ]);

      if (candles.length < 60) return reply.code(422).send({ error: 'Insufficient candle data' });

      const result = analyzeCandles(candles, symbol, tf, health.marketRegime);
      await redis.set(cacheKey, result, TTL.klines(tf));
      return { ...result, cached: false };
    }
  );

  // POST /api/analyze/batch
  fastify.post<{ Body: { symbols: string[]; tf?: string } }>(
    '/batch', async (req, reply) => {
      const { symbols, tf = '1h' } = req.body;
      if (!Array.isArray(symbols) || symbols.length === 0) {
        return reply.code(400).send({ error: 'symbols array required' });
      }
      if (!isValidTimeframe(tf)) return reply.code(400).send({ error: 'Invalid timeframe' });
      if (symbols.length > 50) return reply.code(400).send({ error: 'Max 50 symbols per batch' });

      const health = await getMarketHealth();
      const results: SignalResult[] = [];

      for (const sym of symbols) {
        try {
          const symbol = sym.toUpperCase();
          const cacheKey = CacheKey.analysis(symbol, tf);
          const cached = await redis.get<SignalResult>(cacheKey);
          if (cached) { results.push(cached); continue; }

          const candles = await fetchKlines(symbol, tf, 520);
          if (candles.length >= 60) {
            const r = analyzeCandles(candles, symbol, tf, health.marketRegime);
            await redis.set(cacheKey, r, TTL.klines(tf));
            results.push(r);
          }
          await new Promise(res => setTimeout(res, 120));
        } catch {}
      }

      return { results, count: results.length };
    }
  );
};
