import { Candle } from '../services/binance.service';
import { calcATR, toHeikinAshi } from './core';

export interface UTBotResult {
  trail: number | null;
  rawSignal: 'BUY' | 'SELL' | null;
  direction: 1 | -1 | 0;
}

/**
 * UT Bot — ATR trailing stop signal.
 * Produces raw signals. Quality filtering (Q-UT) is handled in the signal engine.
 * CLOSED CANDLE ONLY.
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
      out[i] = { trail: null, rawSignal: null, direction: 0 };
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

    let rawSignal: 'BUY' | 'SELL' | null = null;
    if (prevClose <= prevTrail && close > trail) { 
      rawSignal = 'BUY';  
      direction = 1;  
    } else if (prevClose >= prevTrail && close < trail) { 
      rawSignal = 'SELL'; 
      direction = -1; 
    }

    out[i] = { trail, rawSignal, direction };
  }

  return out;
}
