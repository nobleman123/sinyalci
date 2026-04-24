import { Candle } from '../services/binance.service';
import { calcATR, toHeikinAshi } from './core';

export interface UTBotResult {
  trail: number | null;
  signal: 'BUY' | 'SELL' | null;
  direction: 1 | -1 | 0;
}

/**
 * UT Bot — ATR trailing stop signal.
 * CLOSED CANDLE ONLY (caller must ensure last candle is closed).
 */
export function calcUTBot(
  candles: Candle[],
  sensitivity = 1.8,
  atrPeriod = 14,
  useHA = false
): UTBotResult[] {
  const src = useHA ? toHeikinAshi(candles) : candles;
  const atr = calcATR(src, atrPeriod);
  const out: UTBotResult[] = new Array(src.length).fill(null);

  let trail: number | null = null;
  let direction: 1 | -1 | 0 = 0;

  for (let i = 0; i < src.length; i++) {
    if (i < atrPeriod || atr[i] == null) {
      out[i] = { trail: null, signal: null, direction: 0 };
      continue;
    }

    const close = src[i].close;
    const prevClose = src[i - 1].close;
    const nLoss = sensitivity * atr[i]!;

    if (trail == null) trail = close - nLoss;
    const prevTrail = trail;

    if (close > prevTrail && prevClose > prevTrail) {
      trail = Math.max(prevTrail, close - nLoss);
    } else if (close < prevTrail && prevClose < prevTrail) {
      trail = Math.min(prevTrail, close + nLoss);
    } else if (close > prevTrail) {
      trail = close - nLoss;
    } else {
      trail = close + nLoss;
    }

    let signal: 'BUY' | 'SELL' | null = null;
    if (prevClose <= prevTrail && close > trail) { signal = 'BUY';  direction = 1;  }
    else if (prevClose >= prevTrail && close < trail) { signal = 'SELL'; direction = -1; }

    out[i] = { trail, signal, direction };
  }

  return out;
}
