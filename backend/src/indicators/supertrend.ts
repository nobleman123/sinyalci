import { Candle } from '../services/binance.service';
import { calcATR } from './core';

export interface SuperTrendResult {
  value: number | null;
  direction: 1 | -1 | 0;
  signal: 'BUY' | 'SELL' | null;
}

/**
 * SuperTrend indicator — ATR-based trailing trend.
 */
export function calcSuperTrend(
  candles: Candle[],
  period = 14,
  mult = 3.5
): SuperTrendResult[] {
  const atr = calcATR(candles, period);
  const out: SuperTrendResult[] = new Array(candles.length).fill(null);

  let finalUpper: number | null = null;
  let finalLower: number | null = null;
  let direction: 1 | -1 | 0 = 0;

  for (let i = 0; i < candles.length; i++) {
    if (i < period || atr[i] == null) {
      out[i] = { value: null, direction: 0, signal: null };
      continue;
    }

    const hl2 = (candles[i].high + candles[i].low) / 2;
    const upper = hl2 + mult * atr[i]!;
    const lower = hl2 - mult * atr[i]!;

    if (finalUpper == null || finalLower == null) { finalUpper = upper; finalLower = lower; }

    finalUpper = (upper < finalUpper! || candles[i - 1].close > finalUpper!) ? upper : finalUpper!;
    finalLower = (lower > finalLower! || candles[i - 1].close < finalLower!) ? lower : finalLower!;

    const old = direction;
    if (candles[i].close > finalUpper!) direction = 1;
    else if (candles[i].close < finalLower!) direction = -1;

    const signal: 'BUY' | 'SELL' | null =
      old !== direction
        ? direction === 1 ? 'BUY' : direction === -1 ? 'SELL' : null
        : null;

    out[i] = {
      value: direction === 1 ? finalLower : finalUpper,
      direction,
      signal,
    };
  }

  return out;
}
