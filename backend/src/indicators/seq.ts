import { Candle } from '../services/binance.service';
import { calcEMA, calcRSI, calcVWAP, calcBB, calcRelativeVolume, calcATR, clamp } from './core';

export interface SEQSide { score: number; label: 'PRIME_ENTRY' | 'GOOD_ENTRY' | 'PULLBACK_WAIT' | 'AVOID'; }
export interface SEQResult { long: SEQSide; short: SEQSide; score: number; direction: 1 | -1; }

function candleRisk(c: Candle) {
  const range = Math.max(c.high - c.low, 1e-9);
  const body  = Math.abs(c.close - c.open);
  const upper = c.high - Math.max(c.open, c.close);
  const lower = Math.min(c.open, c.close) - c.low;
  return {
    isLongUpperWick: upper / range > 0.45,
    isLongLowerWick: lower / range > 0.45,
    isDoji: body / range < 0.15,
  };
}

export function calcSEQ(candles: Candle[], atr: (number | null)[]): (SEQResult | null)[] {
  const closes = candles.map(c => c.close);
  const vwap   = calcVWAP(candles);
  const ema20  = calcEMA(closes, 20);
  const ema50  = calcEMA(closes, 50);
  const rsi    = calcRSI(closes, 14);
  const bb     = calcBB(closes, 20, 2);
  const relVol = calcRelativeVolume(candles, 20);
  const out: (SEQResult | null)[] = new Array(candles.length).fill(null);

  for (let i = 60; i < candles.length; i++) {
    if (!atr[i] || !ema20[i] || !rsi[i]) continue;
    const price = candles[i].close;
    const a = atr[i]!;
    const cr = candleRisk(candles[i]);

    const scoreSide = (side: 'LONG' | 'SHORT'): SEQSide => {
      let score = 100;
      const vwapDist = vwap[i] ? Math.abs(price - vwap[i]!) / a : 0;
      const emaDist  = Math.abs(price - ema20[i]!) / a;
      const e50Dist  = ema50[i] ? Math.abs(price - ema50[i]!) / a : 0;
      const rv = relVol[i] ?? 1;

      if (vwapDist > 3) score -= 25; else if (vwapDist > 2) score -= 15; else if (vwapDist <= 1) score += 5;
      if (emaDist > 2.5) score -= 22; else if (emaDist > 1.5) score -= 12; else if (emaDist < 0.65) score += 8;
      if (e50Dist < 1.2) score += 4;

      if (side === 'LONG') {
        if (rsi[i]! > 72) score -= 24; else if (rsi[i]! > 65) score -= 12;
        else if (rsi[i]! >= 43 && rsi[i]! <= 62) score += 12; else if (rsi[i]! < 35) score -= 10;
        if (bb[i] && price > bb[i]!.upper) score -= 16;
        if (cr.isLongUpperWick) score -= 8;
      } else {
        if (rsi[i]! < 28) score -= 24; else if (rsi[i]! < 35) score -= 12;
        else if (rsi[i]! >= 38 && rsi[i]! <= 57) score += 12; else if (rsi[i]! > 68) score -= 10;
        if (bb[i] && price < bb[i]!.lower) score -= 16;
        if (cr.isLongLowerWick) score -= 8;
      }

      if (rv > 1.15 && rv < 3.2) score += 10;
      else if (rv >= 4.0) score -= 10;
      else if (rv < 0.65) score -= 10;

      const s = Math.round(clamp(score));
      const label: SEQSide['label'] =
        s >= 82 ? 'PRIME_ENTRY' : s >= 70 ? 'GOOD_ENTRY' : s >= 55 ? 'PULLBACK_WAIT' : 'AVOID';
      return { score: s, label };
    };

    const long = scoreSide('LONG');
    const short = scoreSide('SHORT');
    out[i] = { long, short, score: Math.max(long.score, short.score), direction: long.score >= short.score ? 1 : -1 };
  }
  return out;
}
