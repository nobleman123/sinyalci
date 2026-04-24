import { fetchKlines, fetchAllTickers } from '../services/binance.service';
import { fetchFearGreed } from '../services/feargreed.service';
import { redis, CacheKey, TTL } from '../services/cache.service';
import { calcUTBot } from '../indicators/utbot';
import { calcEMA } from '../indicators/core';
import { logger } from '../utils/logger';
import { prisma } from '../db/prisma';

export type MarketRegime = 'STRONG_RISK_ON' | 'RISK_ON' | 'MIXED' | 'RISK_OFF' | 'STRONG_RISK_OFF';

export interface MarketHealth {
  btcTrend:    'BULL' | 'BEAR' | 'NEUTRAL';
  ethTrend:    'BULL' | 'BEAR' | 'NEUTRAL';
  btcDom:      number | null;
  usdtDom:     number | null;
  fearGreed:   number | null;
  marketRegime:MarketRegime;
  regimeScore: number;
  updatedAt:   number;
}

function analyzeTrend(candles: { close: number; high: number; low: number; open: number; volume: number; time: number; openTime: number; closeTime: number; quoteVolume: number; trades: number; takerBuyBase: number; takerBuyQuote: number; isClosed: boolean }[]): 'BULL' | 'BEAR' | 'NEUTRAL' {
  if (candles.length < 20) return 'NEUTRAL';
  const ut = calcUTBot(candles, 1.5, 14, false);
  const closes = candles.map(c => c.close);
  const ema20  = calcEMA(closes, 20);
  const ema50  = calcEMA(closes, 50);
  const last   = candles.length - 1;

  const utDir  = ut[last]?.direction ?? 0;
  const aboveEma = closes[last] > (ema20[last] ?? closes[last]) &&
                   (ema20[last] ?? 0) > (ema50[last] ?? 0);
  const belowEma = closes[last] < (ema20[last] ?? closes[last]) &&
                   (ema20[last] ?? 99999) < (ema50[last] ?? 99999);

  if (utDir === 1 && aboveEma) return 'BULL';
  if (utDir === -1 && belowEma) return 'BEAR';
  return 'NEUTRAL';
}

function calcRegime(
  btcTrend: 'BULL' | 'BEAR' | 'NEUTRAL',
  ethTrend: 'BULL' | 'BEAR' | 'NEUTRAL',
  fearGreed: number | null,
  btcDom:   number | null
): { regime: MarketRegime; score: number } {
  let score = 0;

  if (btcTrend === 'BULL')    score += 2;
  else if (btcTrend === 'BEAR') score -= 2;
  if (ethTrend === 'BULL')    score += 2;
  else if (ethTrend === 'BEAR') score -= 2;

  if (fearGreed != null) {
    if (fearGreed >= 70)      score += 1;
    else if (fearGreed >= 50) score += 0.5;
    else if (fearGreed <= 25) score -= 1;
    else if (fearGreed <= 40) score -= 0.5;
  }

  if (btcDom != null) {
    if (btcDom > 58)          score -= 0.5;
    else if (btcDom < 42)     score += 0.5;
  }

  let regime: MarketRegime;
  if      (score >= 4)  regime = 'STRONG_RISK_ON';
  else if (score >= 2)  regime = 'RISK_ON';
  else if (score >= -1) regime = 'MIXED';
  else if (score >= -3) regime = 'RISK_OFF';
  else                  regime = 'STRONG_RISK_OFF';

  return { regime, score };
}

export async function getMarketHealth(): Promise<MarketHealth> {
  const cached = await redis.get<MarketHealth>(CacheKey.marketHealth());
  if (cached) return cached;
  return await refreshMarketHealth();
}

export async function refreshMarketHealth(): Promise<MarketHealth> {
  try {
    const [btcK, ethK, fg, tickers] = await Promise.allSettled([
      fetchKlines('BTCUSDT', '4h', 100),
      fetchKlines('ETHUSDT', '4h', 100),
      fetchFearGreed(),
      fetchAllTickers(),
    ]);

    const btcCandles = btcK.status === 'fulfilled' ? btcK.value : [];
    const ethCandles = ethK.status === 'fulfilled' ? ethK.value : [];
    const fgData     = fg.status === 'fulfilled'   ? fg.value  : null;
    const allTickers = tickers.status === 'fulfilled' ? tickers.value : [];

    const btcTrend = analyzeTrend(btcCandles);
    const ethTrend = analyzeTrend(ethCandles);

    // Approximate BTC/USDT dominance from Futures volume
    const totalVol = allTickers.reduce((a, t) => a + parseFloat(t.quoteVolume || '0'), 0);
    const btcVol   = allTickers.find(t => t.symbol === 'BTCUSDT');
    const usdtVol  = allTickers.filter(t => t.symbol.includes('USDT')).reduce((a, t) => a + parseFloat(t.quoteVolume || '0'), 0);
    const btcDom   = btcVol && totalVol > 0 ? (parseFloat(btcVol.quoteVolume) / totalVol) * 100 : null;
    const usdtDom  = totalVol > 0 ? (usdtVol / totalVol) * 100 : null;

    const fearGreed = fgData?.value ?? null;
    const { regime, score } = calcRegime(btcTrend, ethTrend, fearGreed, btcDom);

    const health: MarketHealth = {
      btcTrend, ethTrend, btcDom, usdtDom, fearGreed,
      marketRegime: regime, regimeScore: score,
      updatedAt: Date.now(),
    };

    await redis.set(CacheKey.marketHealth(), health, TTL.marketHealth);

    // Persist snapshot
    await prisma.marketSnapshot.create({
      data: {
        btcTrend, ethTrend,
        btcDom:      btcDom ?? undefined,
        usdtDom:     usdtDom ?? undefined,
        fearGreed:   fearGreed ?? undefined,
        marketRegime:regime,
        regimeScore: score,
      },
    }).catch((err: any) => logger.warn('MarketSnapshot save failed', { error: err.message }));

    logger.info('Market health refreshed', { regime, btcTrend, ethTrend, fearGreed });
    return health;
  } catch (err: any) {
    logger.error('Market health refresh failed', { error: err.message });
    const fallback: MarketHealth = {
      btcTrend: 'NEUTRAL', ethTrend: 'NEUTRAL',
      btcDom: null, usdtDom: null, fearGreed: null,
      marketRegime: 'MIXED', regimeScore: 0, updatedAt: Date.now(),
    };
    return fallback;
  }
}
