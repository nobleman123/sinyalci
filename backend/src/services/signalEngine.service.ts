import { Candle } from '../services/binance.service';
import { calcATR, calcEMA, calcRSI, calcVWAP, calcBB, clamp } from '../indicators/core';
import { calcUTBot, UTBotResult } from '../indicators/utbot';
import { calcSuperTrend, SuperTrendResult } from '../indicators/supertrend';
import { calcVRT, VRTResult } from '../indicators/vrt';
import { calcAMC, AMCResult } from '../indicators/amc';
import { calcSEQ, SEQResult } from '../indicators/seq';

export type SignalType =
  | 'CONSENSUS_BUY' | 'CONSENSUS_SELL'
  | 'QUALITY_BUY'   | 'QUALITY_SELL'
  | 'WATCH_LONG'    | 'WATCH_SHORT'
  | 'PULLBACK_LONG' | 'PULLBACK_SHORT'
  | 'LATE_LONG'     | 'LATE_SHORT'
  | 'AVOID' | 'NTZ' | 'DATA_WEAK';

export type Quality = 'A+' | 'A' | 'B' | 'C' | 'AVOID';
export type MarketRegime = 'STRONG_RISK_ON' | 'RISK_ON' | 'MIXED' | 'RISK_OFF' | 'STRONG_RISK_OFF';

export interface SignalResult {
  symbol:        string;
  timeframe:     string;
  signal:        SignalType;
  direction:     'LONG' | 'SHORT' | 'NEUTRAL';
  confidence:    number;
  quality:       Quality;
  seqScore:      number;
  amcScore:      number;
  lateRisk:      number;
  rr:            number;
  entryZone:     { low: number; high: number };
  stopLoss:      number;
  tp1:           number;
  tp2:           number;
  tp3:           number;
  marketRegime:  MarketRegime;
  reasons:       string[];
  candleCloseTime: number;
  rawIndicators: {
    utRaw: number;
    vrtConfirmed: number;
    stTrend: number;
    amcSlope: number;
    emaTrend: number;
    seqScore: number;
  };
}

/**
 * LATE ENTRY RISK MOTOR
 */
function calculateLateRisk(c: Candle[], price: number, atr: number, ema20: number, vwap: number | null, rsi: number): number {
  let risk = 0;
  
  // 1. 24h Change & Recent Movement
  const c24h = ((price - c[Math.max(0, c.length - 97)].close) / c[Math.max(0, c.length - 97)].close) * 100;
  if (Math.abs(c24h) > 15) risk += 30;
  else if (Math.abs(c24h) > 8) risk += 15;

  // 2. Proximity to EMA20 / VWAP
  const emaDist = Math.abs(price - ema20) / Math.max(atr, 1e-9);
  const vwapDist = vwap ? Math.abs(price - vwap) / Math.max(atr, 1e-9) : emaDist;
  risk += Math.min(40, Math.max(emaDist, vwapDist) * 12);

  // 3. RSI Overextension
  if (rsi > 75 || rsi < 25) risk += 25;
  else if (rsi > 70 || rsi < 30) risk += 15;

  // 4. Vertical move (last 3-5 candles)
  const prev5 = c[Math.max(0, c.length - 6)].close;
  const move5 = Math.abs(price - prev5) / prev5 * 100;
  if (move5 > 5) risk += 20;

  return Math.round(clamp(risk, 0, 100));
}

/**
 * ENTRY ZONE & R/R MOTOR
 */
function calculateRR(c: Candle[], price: number, atr: number, isLong: boolean, ema20: number, vwap: number | null): { rr: number; entryZone: { low: number; high: number }; sl: number; tp1: number; tp2: number; tp3: number } {
  const lastN = c.slice(-30);
  const support = Math.min(...lastN.map(x => x.low));
  const resistance = Math.max(...lastN.map(x => x.high));

  const sl = isLong ? Math.min(support, price - 1.5 * atr) : Math.max(resistance, price + 1.5 * atr);
  const tp1 = isLong ? price + Math.abs(price - sl) * 1.5 : price - Math.abs(price - sl) * 1.5;
  const tp2 = isLong ? price + Math.abs(price - sl) * 2.5 : price - Math.abs(price - sl) * 2.5;
  const tp3 = isLong ? price + Math.abs(price - sl) * 4.0 : price - Math.abs(price - sl) * 4.0;

  const rr = Math.abs(tp1 - price) / Math.max(Math.abs(price - sl), 1e-9);

  // Entry zone is typically between current price and EMA20/VWAP or a slight pullback
  const midPoint = vwap ? (ema20 + vwap) / 2 : ema20;
  const entryLow = isLong ? Math.min(price, midPoint) : price;
  const entryHigh = isLong ? price : Math.max(price, midPoint);

  return { rr, entryZone: { low: entryLow, high: entryHigh }, sl, tp1, tp2, tp3 };
}

export function analyzeCandles(
  candles: Candle[],
  symbol: string,
  timeframe: string,
  marketRegime: MarketRegime = 'MIXED'
): SignalResult {
  const dataWeak: SignalResult = {
    symbol, timeframe, signal: 'DATA_WEAK', direction: 'NEUTRAL',
    confidence: 0, quality: 'AVOID', seqScore: 0, amcScore: 50, lateRisk: 100,
    rr: 0, entryZone: { low: 0, high: 0 }, stopLoss: 0, tp1: 0, tp2: 0, tp3: 0,
    marketRegime, reasons: ['Yetersiz veri'], candleCloseTime: 0,
    rawIndicators: { utRaw: 0, vrtConfirmed: 0, stTrend: 0, amcSlope: 0, emaTrend: 0 }
  };

  if (candles.length < 60) return dataWeak;

  // Closed candle mandatory
  let c = [...candles];
  if (c.at(-1) && !c.at(-1)!.isClosed) c = c.slice(0, -1);
  if (c.length < 60) return dataWeak;

  const last = c.length - 1;
  const closes = c.map(x => x.close);
  const atr14  = calcATR(c, 14);
  const ema20  = calcEMA(closes, 20);
  const ema50  = calcEMA(closes, 50);
  const vwap   = calcVWAP(c);
  const rsiArr = calcRSI(closes, 14);
  const bbArr  = calcBB(closes, 20, 2);

  // Indicators
  const utArr  = calcUTBot(c, 1.8, 14, false);
  const vrtArr = calcVRT(c, 2.1, 14);
  const stArr  = calcSuperTrend(c, 14, 3.0);
  const amcArr = calcAMC(c);
  const seqArr = calcSEQ(c, atr14);

  const ut  = utArr[last];
  const vrt = vrtArr[last];
  const st  = stArr[last];
  const amc = amcArr[last];
  const seq = seqArr[last];
  
  const price = c[last].close;
  const atr = atr14[last] || price * 0.01;
  const e20 = ema20[last]!;
  const e50 = ema50[last]!;
  const v = vwap[last];
  const rsi = rsiArr[last] || 50;
  const bb = bbArr[last];

  if (!ut || !vrt || !st || !amc || !seq) return dataWeak;

  const lateRisk = calculateLateRisk(c, price, atr, e20, v, rsi);
  const reasons: string[] = [];

  // ── Q-UT Onay Mekanizması ──
  const isQUtBuy = ut.rawSignal === 'BUY' && price > e20 && rsi >= 45 && rsi <= 68 && amc.score >= 52 && seq.long.score >= 70 && lateRisk <= 35;
  const isQUtSell = ut.rawSignal === 'SELL' && price < e20 && rsi <= 55 && rsi >= 32 && amc.score <= 48 && seq.short.score >= 70 && lateRisk <= 35;

  // ── Q-VRT Onay Mekanizması ──
  const isQVrtBuy = vrt.confirmedSignal === 'BUY';
  const isQVrtSell = vrt.confirmedSignal === 'SELL';

  // ── Trend Filtreleri ──
  const isStLong = st.direction === 1 && price > e50;
  const isStShort = st.direction === -1 && price < e50;

  // ── Final Karar Motoru ──
  let signal: SignalType = 'NTZ';
  let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
  let confidence = 0;

  // Multi-Timeframe Check (Simulated or Basic context)
  const isChop = vrt.regime === 'CHOP' || amc.score > 45 && amc.score < 55 && Math.abs(amc.slope) < 1;

  if (isChop) {
    signal = 'NTZ';
    reasons.push('Piyasa kararsız (CHOP) — işlemden kaçın');
  } else if (isQVrtBuy || isQUtBuy) {
    direction = 'LONG';
    const rrData = calculateRR(c, price, atr, true, e20, v);
    const score = (isQVrtBuy ? 40 : 0) + (isQUtBuy ? 30 : 0) + (isStLong ? 15 : 0) + (amc.slope > 0 ? 10 : 0) + (seq.long.score > 80 ? 5 : 0);
    confidence = score;

    if (score >= 78 && lateRisk <= 30 && rrData.rr >= 1.8 && isStLong) {
      signal = 'CONSENSUS_BUY';
    } else if (score >= 60 && lateRisk <= 35 && rrData.rr >= 1.5) {
      signal = 'QUALITY_BUY';
    } else if (lateRisk > 50) {
      signal = 'LATE_LONG';
    } else if (lateRisk > 35) {
      signal = 'PULLBACK_LONG';
    } else {
      signal = 'WATCH_LONG';
    }
  } else if (isQVrtSell || isQUtSell) {
    direction = 'SHORT';
    const rrData = calculateRR(c, price, atr, false, e20, v);
    const score = (isQVrtSell ? 40 : 0) + (isQUtSell ? 30 : 0) + (isStShort ? 15 : 0) + (amc.slope < 0 ? 10 : 0) + (seq.short.score > 80 ? 5 : 0);
    confidence = score;

    if (score >= 78 && lateRisk <= 30 && rrData.rr >= 1.8 && isStShort) {
      signal = 'CONSENSUS_SELL';
    } else if (score >= 60 && lateRisk <= 35 && rrData.rr >= 1.5) {
      signal = 'QUALITY_SELL';
    } else if (lateRisk > 50) {
      signal = 'LATE_SHORT';
    } else if (lateRisk > 35) {
      signal = 'PULLBACK_SHORT';
    } else {
      signal = 'WATCH_SHORT';
    }
  }

  // Reasons
  if (isQVrtBuy) reasons.push('Q-VRT Onaylı Breakout/Trend Sinyali');
  if (isQUtBuy) reasons.push('Q-UT Bot Kalite Onaylı Alım Sinyali');
  if (isStLong) reasons.push('SuperTrend & EMA50 HTF Trend Pozitif');
  if (amc.slope > 1) reasons.push('Momentum Güçleniyor (AMC Slope+)');
  if (seq.long.score >= 85) reasons.push('SEQ Prime Giriş Bölgesi');
  if (lateRisk > 35) reasons.push(`Yüksek Geç Giriş Riski (%${lateRisk})`);
  
  const rrFinal = calculateRR(c, price, atr, direction === 'LONG', e20, v);
  
  // Quality classification
  let quality: Quality = 'AVOID';
  if (confidence >= 78 && lateRisk <= 30) quality = 'A+';
  else if (confidence >= 65 && lateRisk <= 35) quality = 'A';
  else if (confidence >= 50) quality = 'B';
  else if (confidence >= 30) quality = 'C';

  return {
    symbol, timeframe, signal, direction, confidence, quality,
    seqScore: direction === 'LONG' ? seq.long.score : direction === 'SHORT' ? seq.short.score : 0,
    amcScore: amc.score, lateRisk,
    rr: parseFloat(rrFinal.rr.toFixed(2)),
    entryZone: { low: parseFloat(rrFinal.entryZone.low.toFixed(4)), high: parseFloat(rrFinal.entryZone.high.toFixed(4)) },
    stopLoss: parseFloat(rrFinal.sl.toFixed(4)),
    tp1: parseFloat(rrFinal.tp1.toFixed(4)),
    tp2: parseFloat(rrFinal.tp2.toFixed(4)),
    tp3: parseFloat(rrFinal.tp3.toFixed(4)),
    marketRegime, reasons, candleCloseTime: c[last].closeTime,
    rawIndicators: {
      utRaw: ut.rawSignal === 'BUY' ? 1 : ut.rawSignal === 'SELL' ? -1 : 0,
      vrtConfirmed: vrt.confirmedSignal === 'BUY' ? 1 : vrt.confirmedSignal === 'SELL' ? -1 : 0,
      stTrend: st.direction,
      amcSlope: amc.slope,
      emaTrend: price > e20 ? 1 : -1,
      seqScore: direction === 'LONG' ? seq.long.score : direction === 'SHORT' ? seq.short.score : 0,
    }
  };
}
