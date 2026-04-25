import { Candle } from '../services/binance.service';
import { calcATR, calcBB, calcADX, calcRelativeVolume, calcEMA, calcBBPercentile, getCandleQuality } from './core';

export type VRTRegime = 'CHOP' | 'SQUEEZE_PREP' | 'RANGE' | 'TREND' | 'BREAKOUT' | 'UNKNOWN';

export interface VRTResult {
  trail: number | null;
  rawSignal: 'BUY' | 'SELL' | null;
  confirmedSignal: 'BUY' | 'SELL' | null;
  direction: 1 | -1 | 0;
  regime: VRTRegime;
  adx: number;
  relVol: number;
  bbPercentile: number;
  isConfirmed: boolean;
}

/**
 * Q-VRT — Quality Volatility Regime Trail.
 * Stricter signal generation with multiple filters and regime awareness.
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
  const bbP    = calcBBPercentile(bb, 100);
  const adxArr = calcADX(candles, 14);
  const relVol = calcRelativeVolume(candles, 20);
  const ema20  = calcEMA(closes, 20);
  const ema50  = calcEMA(closes, 50);
  
  const out: VRTResult[] = new Array(candles.length).fill(null);

  let trail: number | null = null;
  let direction: 1 | -1 | 0 = 0;
  let lastSignalIdx = -20; // For cooldown

  for (let i = 0; i < candles.length; i++) {
    if (i < 60 || atr[i] == null || !bb[i] || bbP[i] == null || adxArr[i] == null) {
      out[i] = { trail: null, rawSignal: null, confirmedSignal: null, direction: 0, regime: 'UNKNOWN', adx: 0, relVol: 1, bbPercentile: 50, isConfirmed: false };
      continue;
    }

    const bbW     = bb[i]!.width;
    const bbp     = bbP[i]!;
    const adxNow   = adxArr[i]!;
    const adxPrev  = adxArr[Math.max(0, i - 3)] ?? adxNow;
    const rv      = relVol[i] ?? 1;
    const quality = getCandleQuality(candles[i]);
    const close   = candles[i].close;
    const high    = candles[i].high;
    const low     = candles[i].low;

    // ── 1. Regime Classification (Refined) ──
    let regime: VRTRegime = 'RANGE';
    
    // CHOP: ADX < 18, Low BB width, price hugging EMA20
    const emaDist = Math.abs(close - (ema20[i] ?? close)) / (close * 0.001);
    if (adxNow < 18 && bbp < 30 && emaDist < 5) {
      regime = 'CHOP';
    } 
    // SQUEEZE_PREP: Low BB width percentile, ADX starting to rise
    else if (bbp < 20 && adxNow > adxPrev) {
      regime = 'SQUEEZE_PREP';
    }
    // BREAKOUT: Wide BB, high RelVol, rising ADX
    else if (bbp > 70 && rv > 1.5 && adxNow > adxPrev && adxNow > 22) {
      regime = 'BREAKOUT';
    }
    // TREND: Decent ADX and aligned EMAs
    else if (adxNow >= 22 && ema20[i] !== null && ema50[i] !== null) {
      regime = 'TREND';
    }

    // ── 2. Adaptive Trailing Stop ──
    let mult = baseSensitivity;
    if (regime === 'CHOP')         mult = baseSensitivity * 1.65;
    else if (regime === 'SQUEEZE_PREP') mult = baseSensitivity * 1.25;
    else if (regime === 'BREAKOUT')     mult = baseSensitivity / 1.35;

    const stopDist = mult * atr[i]!;
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

    // ── 3. Raw Signal Generation (Internal) ──
    let rawSignal: 'BUY' | 'SELL' | null = null;
    if (prevClose <= prevTrail && close > trail) { 
      rawSignal = 'BUY';  
      direction = 1;  
    } else if (prevClose >= prevTrail && close < trail) { 
      rawSignal = 'SELL'; 
      direction = -1; 
    }

    // ── 4. Signal Confirmation (The "Quality" Gate) ──
    let confirmedSignal: 'BUY' | 'SELL' | null = null;
    let isConfirmed = false;

    // Range high/low for breakout (Lookback 30)
    const rangeSlice = candles.slice(Math.max(0, i - 30), i);
    const rangeHigh = rangeSlice.length > 0 ? Math.max(...rangeSlice.map(c => c.high)) : high;
    const rangeLow  = rangeSlice.length > 0 ? Math.min(...rangeSlice.map(c => c.low)) : low;

    // Cooldown check (10 candles)
    const onCooldown = (i - lastSignalIdx) < 10;

    if (rawSignal === 'BUY' && !onCooldown && regime !== 'CHOP') {
      const longConf = (
        close > trail &&
        ema20[i] !== null && close > ema20[i]! &&
        (ema50[i] === null || ema20[i]! >= ema50[i]! || close > ema50[i]!) &&
        adxNow >= 20 &&
        rv >= 1.15 &&
        quality.bodyRatio >= 0.45 &&
        quality.upperWickRatio < 0.40 &&
        (regime !== 'BREAKOUT' || (close > rangeHigh && rv >= 1.5))
      );
      
      if (longConf) {
        confirmedSignal = 'BUY';
        isConfirmed = true;
        lastSignalIdx = i;
      }
    } else if (rawSignal === 'SELL' && !onCooldown && regime !== 'CHOP') {
      const shortConf = (
        close < trail &&
        ema20[i] !== null && close < ema20[i]! &&
        (ema50[i] === null || ema20[i]! <= ema50[i]! || close < ema50[i]!) &&
        adxNow >= 20 &&
        rv >= 1.15 &&
        quality.bodyRatio >= 0.45 &&
        quality.lowerWickRatio < 0.40 &&
        (regime !== 'BREAKOUT' || (close < rangeLow && rv >= 1.5))
      );

      if (shortConf) {
        confirmedSignal = 'SELL';
        isConfirmed = true;
        lastSignalIdx = i;
      }
    }

    out[i] = { trail, rawSignal, confirmedSignal, direction, regime, adx: adxNow, relVol: rv, bbPercentile: bbp, isConfirmed };
  }

  return out;
}
