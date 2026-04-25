import { Candle } from '../services/binance.service';
import { calcEMA, calcRSI, calcVWAP, calcBB, calcRelativeVolume, getCandleQuality, clamp } from './core';

export type SEQLabel = 'PRIME_ENTRY' | 'GOOD_ENTRY' | 'PULLBACK_WAIT' | 'AVOID';

export interface SEQSide { 
  score: number; 
  label: SEQLabel; 
}

export interface SEQResult { 
  long: SEQSide; 
  short: SEQSide; 
  score: number; 
  direction: 1 | -1; 
}

/**
 * SEQ — Smart Entry Quality engine.
 * The primary gatekeeper for signal generation.
 */
export function calcSEQ(candles: Candle[], atr: (number | null)[]): (SEQResult | null)[] {
  const closes = candles.map(c => c.close);
  const vwap   = calcVWAP(candles);
  const ema20  = calcEMA(closes, 20);
  const rsi    = calcRSI(closes, 14);
  const bb     = calcBB(closes, 20, 2);
  const relVol = calcRelativeVolume(candles, 20);
  const out: (SEQResult | null)[] = new Array(candles.length).fill(null);

  for (let i = 60; i < candles.length; i++) {
    if (!atr[i] || !ema20[i] || !rsi[i]) continue;
    
    const price = candles[i].close;
    const a = atr[i]!;
    const quality = getCandleQuality(candles[i]);
    const rv = relVol[i] ?? 1;

    const calculateSide = (side: 'LONG' | 'SHORT'): SEQSide => {
      let score = 80; // Baseline
      
      const vwapVal = vwap[i];
      const ema20Val = ema20[i]!;
      const rsiVal = rsi[i]!;
      const bbVal = bb[i];

      // ── 1. EMA/VWAP Proximity ──
      const vwapDist = vwapVal ? Math.abs(price - vwapVal) / a : 1;
      const emaDist  = Math.abs(price - ema20Val) / a;

      if (side === 'LONG') {
        if (price > ema20Val && emaDist < 1.0) score += 10; // Near EMA20
        if (emaDist > 2.0) score -= 25; // Overextended
        if (vwapVal && price > vwapVal && vwapDist < 1.0) score += 5;
        
        // ── 2. RSI Optimization ──
        if (rsiVal >= 45 && rsiVal <= 62) score += 12; // Ideal
        else if (rsiVal > 72) score -= 25; // Late
        else if (rsiVal < 35) score -= 15; // Weak
        
        // ── 3. BB & Wick ──
        if (bbVal && price > bbVal.upper) score -= 20;
        if (quality.upperWickRatio > 0.40) score -= 15;
      } else {
        if (price < ema20Val && emaDist < 1.0) score += 10;
        if (emaDist > 2.0) score -= 25;
        if (vwapVal && price < vwapVal && vwapDist < 1.0) score += 5;
        
        if (rsiVal >= 38 && rsiVal <= 55) score += 12;
        else if (rsiVal < 28) score -= 25;
        else if (rsiVal > 65) score -= 15;
        
        if (bbVal && price < bbVal.lower) score -= 20;
        if (quality.lowerWickRatio > 0.40) score -= 15;
      }

      // ── 4. Volume ──
      if (rv >= 1.2 && rv <= 2.8) score += 10;
      else if (rv > 4.0) score -= 15; // Spike risk

      const finalScore = Math.round(clamp(score));
      let label: SEQLabel = 'AVOID';
      if (finalScore >= 85) label = 'PRIME_ENTRY';
      else if (finalScore >= 70) label = 'GOOD_ENTRY';
      else if (finalScore >= 55) label = 'PULLBACK_WAIT';

      return { score: finalScore, label };
    };

    const long = calculateSide('LONG');
    const short = calculateSide('SHORT');
    
    out[i] = { 
      long, 
      short, 
      score: Math.max(long.score, short.score), 
      direction: long.score >= short.score ? 1 : -1 
    };
  }

  return out;
}
