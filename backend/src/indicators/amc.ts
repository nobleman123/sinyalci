import { Candle } from '../services/binance.service';
import { calcRSI, calcMACD, calcStoch, calcRelativeVolume, clamp } from './core';

export interface AMCResult {
  score: number;
  slope: number; // Positive if increasing, negative if decreasing
}

/**
 * AMC — Adaptive Momentum Classifier.
 * Aggregates multiple momentum sources and provides a trend slope.
 */
export function calcAMC(candles: Candle[]): (AMCResult | null)[] {
  const closes = candles.map(c => c.close);
  const rsi14  = calcRSI(closes, 14);
  const rsi30  = calcRSI(closes, 30);
  const macd   = calcMACD(closes);
  const st     = calcStoch(candles, 30);
  const relVol = calcRelativeVolume(candles, 20);
  const out: (AMCResult | null)[] = new Array(candles.length).fill(null);

  const rawScores: (number | null)[] = new Array(candles.length).fill(null);

  for (let i = 60; i < candles.length; i++) {
    if (rsi14[i] == null || rsi30[i] == null || macd.hist[i] == null ||
        st.k[i] == null || st.d[i] == null) continue;

    const rsiScore = rsi14[i]! * 0.40 + rsi30[i]! * 0.60;
    const accel = macd.hist[i]! - (macd.hist[i - 1] ?? macd.hist[i]!);
    const histSlice = macd.hist.slice(Math.max(0, i - 60), i).filter((v): v is number => v !== null);
    const mean = histSlice.reduce((a, b) => a + b, 0) / Math.max(histSlice.length, 1);
    const sd   = Math.sqrt(histSlice.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(histSlice.length, 1));
    const macdScore  = clamp(50 + (accel / (Math.abs(sd) || Math.abs(mean) || 1e-9)) * 12);
    const stochScore = clamp(st.k[i]! * 0.58 + st.d[i]! * 0.42 + (st.k[i]! > st.d[i]! ? 4 : -4));
    const volScore   = clamp(50 + ((relVol[i] ?? 1) - 1) * 15, 35, 70);

    const score = Math.round(clamp(rsiScore * 0.42 + macdScore * 0.25 + stochScore * 0.25 + volScore * 0.08));
    rawScores[i] = score;

    // Calculate slope over last 3 candles
    let slope = 0;
    if (rawScores[i-1] != null && rawScores[i-2] != null) {
      slope = (rawScores[i]! - rawScores[i-2]!) / 2;
    }

    out[i] = { score, slope };
  }
  return out;
}
