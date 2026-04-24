import { Candle } from '../services/binance.service';
import { calcATR, calcEMA, calcRSI, calcVWAP, calcBB } from '../indicators/core';
import { calcUTBot, UTBotResult } from '../indicators/utbot';
import { calcSuperTrend, SuperTrendResult } from '../indicators/supertrend';
import { calcVRT, VRTResult } from '../indicators/vrt';
import { calcAMC } from '../indicators/amc';
import { calcSEQ, SEQResult } from '../indicators/seq';

export type SignalType =
  | 'CONSENSUS_BUY' | 'CONSENSUS_SELL'
  | 'QUALITY_BUY'   | 'QUALITY_SELL'
  | 'WATCH_LONG'    | 'WATCH_SHORT'
  | 'PREP_LONG'     | 'PREP_SHORT'
  | 'PULLBACK_LONG' | 'PULLBACK_SHORT'
  | 'LATE_LONG'     | 'LATE_SHORT'
  | 'SLEEPING_LONG' | 'SLEEPING_SHORT'
  | 'NEUTRAL' | 'NTZ' | 'AVOID' | 'DATA_WEAK';

export type Quality = 'A+' | 'A' | 'B' | 'C' | 'AVOID';
export type MarketRegime = 'STRONG_RISK_ON' | 'RISK_ON' | 'MIXED' | 'RISK_OFF' | 'STRONG_RISK_OFF';

export interface RiskReward {
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  rr: number;
}

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
  isSleeping:    boolean;
  rawIndicators: {
    ut: number;
    vrt: number;
    st: number;
    amc: number;
    ema: number;
    seqScore: number;
  };
}

function calcLateRisk(price: number, atr: number, ema20: number, vwap: number | null): number {
  const emaDist  = Math.abs(price - ema20) / Math.max(atr, 1e-9);
  const vwapDist = vwap ? Math.abs(price - vwap) / Math.max(atr, 1e-9) : 0;
  const distScore = Math.max(emaDist, vwapDist);
  return Math.round(Math.min(100, distScore * 20));
}

function buildRR(
  price: number, atr: number, isLong: boolean
): RiskReward {
  const sl  = isLong ? price - 1.5 * atr : price + 1.5 * atr;
  const tp1 = isLong ? price + 1.5 * atr : price - 1.5 * atr;
  const tp2 = isLong ? price + 3.0 * atr : price - 3.0 * atr;
  const tp3 = isLong ? price + 5.0 * atr : price - 5.0 * atr;
  const rr  = Math.abs(tp1 - price) / Math.max(Math.abs(price - sl), 1e-9);
  return {
    entryLow:  isLong ? price - 0.3 * atr : price + 0.3 * atr,
    entryHigh: isLong ? price + 0.2 * atr : price - 0.2 * atr,
    stopLoss: sl, tp1, tp2, tp3, rr,
  };
}

function calcQuality(confidence: number, seqScore: number, lateRisk: number, rr: number): Quality {
  if (confidence >= 85 && seqScore >= 80 && lateRisk <= 20 && rr >= 2.2) return 'A+';
  if (confidence >= 78 && seqScore >= 70 && lateRisk <= 30 && rr >= 1.8) return 'A';
  if (confidence >= 68 && seqScore >= 58 && lateRisk <= 45) return 'B';
  if (confidence >= 55) return 'C';
  return 'AVOID';
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
    marketRegime, reasons: ['Yetersiz veri'], candleCloseTime: 0, isSleeping: false,
    rawIndicators: { ut: 0, vrt: 0, st: 0, amc: 50, ema: 0, seqScore: 0 }
  };

  if (candles.length < 60) return dataWeak;

  // Ensure closed candle only
  let c = [...candles];
  if (c.at(-1) && !c.at(-1)!.isClosed) c = c.slice(0, -1);
  if (c.length < 60) return dataWeak;

  const last = c.length - 1;
  const closes = c.map(x => x.close);
  const atr14  = calcATR(c, 14);
  const ema20  = calcEMA(closes, 20);
  const ema50  = calcEMA(closes, 50);
  const rsi    = calcRSI(closes, 14);
  const vwap   = calcVWAP(c);
  const bb     = calcBB(closes, 20, 2);

  const utArr  = calcUTBot(c, 1.8, 14, false);
  const vrtArr = calcVRT(c, 2.1, 14);
  const stArr  = calcSuperTrend(c, 14, 3.5);
  const amcArr = calcAMC(c);
  const seqArr = calcSEQ(c, atr14);

  const ut  = utArr[last]  as UTBotResult;
  const vrt = vrtArr[last] as VRTResult;
  const st  = stArr[last]  as SuperTrendResult;
  const amc = amcArr[last] ?? 50;
  const seq = seqArr[last] as SEQResult | null;
  const atr = atr14[last]  ?? c[last].close * 0.01;
  const price= c[last].close;
  const e20  = ema20[last];
  const e50  = ema50[last];
  const rsiV = rsi[last] ?? 50;
  const vwapV= vwap[last];
  const candleCloseTime = c[last].closeTime;

  if (!ut || !vrt || !st || e20 == null || e50 == null) return dataWeak;

  // ── Direction votes ───────────────────────────────────────────────────
  const bullVotes = [
    ut.direction  === 1 ? 1 : 0,
    vrt.direction === 1 ? 1 : 0,
    st.direction  === 1 ? 1 : 0,
    amc >= 55        ? 1 : 0,
    price > e20      ? 1 : 0,
  ];
  const bearVotes = [
    ut.direction  === -1 ? 1 : 0,
    vrt.direction === -1 ? 1 : 0,
    st.direction  === -1 ? 1 : 0,
    amc <= 45         ? 1 : 0,
    price < e20       ? 1 : 0,
  ];
  const bullScore = bullVotes.reduce((a, b) => a + b, 0);
  const bearScore = bearVotes.reduce((a, b) => a + b, 0);

  const isLong  = bullScore > bearScore;
  const seqScore= seq ? (isLong ? seq.long.score : seq.short.score) : 0;
  const lateRisk= calcLateRisk(price, atr, e20, vwapV);
  const rrData  = buildRR(price, atr, isLong);
  const reasons: string[] = [];

  // ── Reason building ───────────────────────────────────────────────────
  if (ut.direction === 1)  reasons.push('UT Bot trail üstünde kapanış');
  if (ut.direction === -1) reasons.push('UT Bot trail altında kapanış');
  if (vrt.regime === 'BREAKOUT') reasons.push('VRT Breakout rejimi aktif');
  if (vrt.regime === 'TREND')    reasons.push('VRT Trend rejimi devam ediyor');
  if (vrt.regime === 'CHOP')     reasons.push('VRT CHOP — sinyal kalitesi düşük');
  if (st.direction === 1)  reasons.push('SuperTrend yükseliş yönünde');
  if (st.direction === -1) reasons.push('SuperTrend düşüş yönünde');
  if (amc >= 60 && amc <= 75)  reasons.push(`AMC sağlıklı momentum bölgesinde (${amc})`);
  if (amc > 75)                reasons.push(`AMC aşırı alım bölgesine yakın (${amc})`);
  if (amc < 35)                reasons.push(`AMC bearish momentum bölgesinde (${amc})`);
  if (seqScore >= 82)          reasons.push('SEQ prime entry bölgesi');
  if (seqScore >= 70)          reasons.push('SEQ kaliteli giriş noktası');
  if (seqScore < 55)           reasons.push('SEQ düşük — geç giriş riski yüksek');
  reasons.push(`R/R: ${rrData.rr.toFixed(2)}`);
  if (lateRisk > 35)  reasons.push('Fiyat EMA/VWAP\'tan uzaklaşmış — geç giriş riski');
  if (lateRisk <= 20) reasons.push('Geç giriş riski düşük');
  if (rsiV > 70) reasons.push('RSI aşırı alım bölgesinde — dikkat');
  if (rsiV < 30) reasons.push('RSI aşırı satım bölgesinde — dikkat');
  if (marketRegime === 'RISK_OFF')        reasons.push('Market regime RISK_OFF — long dikkatli');
  if (marketRegime === 'STRONG_RISK_OFF') reasons.push('Market regime STRONG_RISK_OFF — long baskılı');

  // ── Signal classification ─────────────────────────────────────────────
  const hasFreshSignal = ut.signal != null || vrt.signal != null || st.signal != null;
  const regimeSuppressLong = marketRegime === 'STRONG_RISK_OFF';
  const c24h = parseFloat((((price - c[Math.max(0, last - 96)].close) / c[Math.max(0, last - 96)].close) * 100).toFixed(2));

  let signal: SignalType;
  let confidence: number;
  let direction: 'LONG' | 'SHORT' | 'NEUTRAL';

  // ── SLEEPING COIN check (not yet pumped, setup forming) ───────────────
  const isSleeping = (
    Math.abs(c24h) < 6 &&
    lateRisk < 25 &&
    seqScore >= 65 &&
    (vrt.regime === 'SQUEEZE_PREP' || vrt.regime === 'RANGE') &&
    amc >= 45 && amc <= 70 &&
    rrData.rr >= 1.8
  );

  if (isLong) {
    direction = 'LONG';
    if (regimeSuppressLong) {
      signal = 'WATCH_LONG';
      confidence = Math.round((bullScore / 5) * 100 * 0.6);
    } else if (bullScore >= 4 && amc >= 60 && seqScore >= 75 && hasFreshSignal && lateRisk <= 30 && rrData.rr >= 1.8 && rsiV <= 72) {
      signal = 'CONSENSUS_BUY';
      confidence = Math.round(70 + bullScore * 3 + (seqScore - 70) * 0.3);
    } else if (bullScore >= 3 && amc >= 55 && seqScore >= 65 && hasFreshSignal && lateRisk <= 40 && rrData.rr >= 1.6) {
      signal = 'QUALITY_BUY';
      confidence = Math.round(60 + bullScore * 3 + (seqScore - 65) * 0.2);
    } else if (lateRisk > 40 && bullScore >= 3) {
      signal = 'LATE_LONG';
      confidence = Math.round((bullScore / 5) * 100 * 0.7);
      reasons.push('Fiyat çok uzamış — pullback bekle, piyasadan AL önerilmez');
    } else if (amc > 72 && bullScore >= 2 && c24h > 8) {
      signal = 'PULLBACK_LONG';
      confidence = Math.round((bullScore / 5) * 100 * 0.75);
      reasons.push('Coin zaten yükselmiş — dip geri çekilmesi bekleniyor');
    } else if (isSleeping) {
      signal = 'SLEEPING_LONG';
      confidence = Math.round(55 + seqScore * 0.3);
      reasons.push('Henüz şişmemiş setup — VWAP/EMA yakınında bekliyor');
    } else if (bullScore >= 2) {
      signal = 'WATCH_LONG';
      confidence = Math.round((bullScore / 5) * 100 * 0.8);
    } else {
      signal = 'NTZ';
      confidence = 30;
      direction = 'NEUTRAL';
    }
  } else if (bearScore > bullScore) {
    direction = 'SHORT';
    if (bearScore >= 4 && amc <= 40 && seqScore >= 75 && hasFreshSignal && lateRisk <= 30 && rrData.rr >= 1.8 && rsiV >= 28) {
      signal = 'CONSENSUS_SELL';
      confidence = Math.round(70 + bearScore * 3 + (seqScore - 70) * 0.3);
    } else if (bearScore >= 3 && amc <= 45 && seqScore >= 65 && hasFreshSignal && lateRisk <= 40 && rrData.rr >= 1.6) {
      signal = 'QUALITY_SELL';
      confidence = Math.round(60 + bearScore * 3 + (seqScore - 65) * 0.2);
    } else if (lateRisk > 40 && bearScore >= 3) {
      signal = 'LATE_SHORT';
      confidence = Math.round((bearScore / 5) * 100 * 0.7);
      reasons.push('Fiyat çok düşmüş — short için geç, rebound riski var');
    } else if (amc < 28 && bearScore >= 2 && c24h < -8) {
      signal = 'PULLBACK_SHORT';
      confidence = Math.round((bearScore / 5) * 100 * 0.75);
      reasons.push('Coin zaten düşmüş — tepki rallisi bekleniyor');
    } else if (isSleeping) {
      signal = 'SLEEPING_SHORT';
      confidence = Math.round(55 + seqScore * 0.3);
    } else if (bearScore >= 2) {
      signal = 'WATCH_SHORT';
      confidence = Math.round((bearScore / 5) * 100 * 0.8);
    } else {
      signal = 'NTZ';
      confidence = 30;
      direction = 'NEUTRAL';
    }
  } else {
    signal = 'NEUTRAL';
    confidence = 30;
    direction = 'NEUTRAL';
  }

  confidence = Math.min(99, Math.max(0, confidence));
  const quality = calcQuality(confidence, seqScore, lateRisk, rrData.rr);

  return {
    symbol, timeframe, signal, direction, confidence, quality,
    seqScore, amcScore: amc, lateRisk,
    rr: parseFloat(rrData.rr.toFixed(2)),
    entryZone: { low: parseFloat(rrData.entryLow.toFixed(4)), high: parseFloat(rrData.entryHigh.toFixed(4)) },
    stopLoss: parseFloat(rrData.stopLoss.toFixed(4)),
    tp1: parseFloat(rrData.tp1.toFixed(4)),
    tp2: parseFloat(rrData.tp2.toFixed(4)),
    tp3: parseFloat(rrData.tp3.toFixed(4)),
    marketRegime, reasons, candleCloseTime, isSleeping,
    rawIndicators: {
      ut: ut.direction,
      vrt: vrt.direction,
      st: st.direction,
      amc,
      ema: price > e20 ? 1 : price < e20 ? -1 : 0,
      seqScore,
    }
  };
}
