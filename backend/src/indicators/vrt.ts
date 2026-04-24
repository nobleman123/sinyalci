import { Candle } from '../services/binance.service';
import { calcATR, calcBB, calcADX, calcRelativeVolume, calcEMA } from './core';

export type VRTRegime = 'CHOP' | 'SQUEEZE_PREP' | 'RANGE' | 'TREND' | 'BREAKOUT' | 'UNKNOWN';

export interface VRTResult {
  trail: number | null;
  signal: 'BUY' | 'SELL' | null;
  direction: 1 | -1 | 0;
  regime: VRTRegime;
  adx: number;
  relVol: number;
}

/**
 * VRT — Volatility Regime Trend indicator.
 * Adaptive trailing stop that changes sensitivity based on market regime.
 */
export function calcVRT(
  candles: Candle[],
  baseSensitivity = 2.1,
  atrPeriod = 14,
  bbPeriod = 20,
  bbMult = 2
): VRTResult[] {
  const closes = candles.map(c => c.close);
  const atr    = calcATR(candles, atrPeriod);
  const bb     = calcBB(closes, bbPeriod, bbMult);
  const adxArr = calcADX(candles, 14);
  const relVol = calcRelativeVolume(candles, 20);
  const ema20  = calcEMA(closes, 20);
  const ema50  = calcEMA(closes, 50);
  const out: VRTResult[] = new Array(candles.length).fill(null);

  let trail: number | null = null;
  let direction: 1 | -1 | 0 = 0;

  for (let i = 0; i < candles.length; i++) {
    if (i < 60 || atr[i] == null || !bb[i]) {
      out[i] = { trail: null, signal: null, direction: 0, regime: 'UNKNOWN', adx: 0, relVol: 1 };
      continue;
    }

    const bbW    = bb[i]!.width;
    const adxNow = adxArr[i] ?? 0;
    const adxPrev= adxArr[Math.max(0, i - 4)] ?? adxNow;
    const rv     = relVol[i] ?? 1;

    // Regime classification
    let regime: VRTRegime = 'RANGE';
    if (bbW < 0.018 && adxNow < 18)                    regime = 'CHOP';
    else if (bbW < 0.022 && adxNow > adxPrev + 1.5)    regime = 'SQUEEZE_PREP';
    else if (bbW > 0.045 && rv > 1.35)                  regime = 'BREAKOUT';
    else if (adxNow >= 22 && (ema20[i] !== null) && (ema50[i] !== null)) regime = 'TREND';

    // Adaptive sensitivity
    let mult = baseSensitivity;
    if (regime === 'CHOP')         mult = baseSensitivity * 1.65;
    else if (regime === 'SQUEEZE_PREP') mult = baseSensitivity * 1.25;
    else if (regime === 'BREAKOUT')     mult = baseSensitivity / 1.35;

    const stopDist = mult * atr[i]!;
    const close    = candles[i].close;
    const prevClose= candles[i - 1].close;

    if (trail == null) trail = close - stopDist;
    const prevTrail = trail;

    if (close > prevTrail && prevClose > prevTrail) {
      trail = Math.max(prevTrail, close - stopDist);
    } else if (close < prevTrail && prevClose < prevTrail) {
      trail = Math.min(prevTrail, close + stopDist);
    } else if (close > prevTrail) {
      trail = close - stopDist;
    } else {
      trail = close + stopDist;
    }

    let signal: 'BUY' | 'SELL' | null = null;
    if (prevClose <= prevTrail && close > trail) { signal = 'BUY';  direction = 1;  }
    else if (prevClose >= prevTrail && close < trail) { signal = 'SELL'; direction = -1; }

    // Suppress signals during CHOP
    if (regime === 'CHOP') signal = null;

    out[i] = { trail, signal, direction, regime, adx: adxNow, relVol: rv };
  }

  return out;
}
