import { Candle } from '../types';

export type SignalType = 'PREPARE' | 'EARLY_ENTRY' | 'CONFIRMED_BUY' | 'AVOID' | 'EXIT' | 'NEUTRAL';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface SignalResult {
  signal: SignalType;
  confidence: number;
  risk: RiskLevel;
  entryZone?: { from: number; to: number };
  stopLoss?: number;
  takeProfits?: number[];
  reasons: string[];
  indicators: {
    utBot: string;
    superTrend: string;
    emaTrend: string;
    rsi: number;
    atr: number;
    volumeScore: number;
  };
  marketRegime: {
    btcTrend: string;
    riskMode: string;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let ema = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    ema = i === 0 ? values[0] : (values[i] - ema) * k + ema;
    result.push(ema);
  }
  return result;
}

function calcATR(candles: Candle[], period = 14): number[] {
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1]?.close ?? candles[i].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const atrs: number[] = [trs[0]];
  for (let i = 1; i < trs.length; i++) {
    atrs.push((atrs[i - 1] * (period - 1) + trs[i]) / period);
  }
  return atrs;
}

function calcRSI(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d > 0) gains += d; else losses -= d;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

// ─── UT Bot (ATR-based trailing stop) ────────────────────────────────────────

function calcUTBot(candles: Candle[], atrArr: number[], sensitivity = 1): { direction: number; prepare: boolean }[] {
  const result: { direction: number; prepare: boolean }[] = [];
  let trailingStop = candles[0].close;
  let prevClose = candles[0].close;
  let dir = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const atr = atrArr[i] ?? 0;
    const key = sensitivity * atr;
    let newStop = c.close > trailingStop ? Math.max(trailingStop, c.close - key) : Math.min(trailingStop, c.close + key);
    const bullish = prevClose < trailingStop && c.close > trailingStop;
    const bearish = prevClose > trailingStop && c.close < trailingStop;
    if (bullish) dir = 1;
    if (bearish) dir = -1;
    const prepare = dir === 1 && c.close > newStop && atr > 0;
    result.push({ direction: dir, prepare });
    trailingStop = newStop;
    prevClose = c.close;
  }
  return result;
}

// ─── SuperTrend ───────────────────────────────────────────────────────────────

function calcSuperTrend(candles: Candle[], atrArr: number[], multiplier = 3): { direction: number }[] {
  const result: { direction: number }[] = [];
  let dir = 1, upperBand = 0, lowerBand = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const atr = atrArr[i] ?? 0;
    const hl2 = (c.high + c.low) / 2;
    const newUpper = hl2 + multiplier * atr;
    const newLower = hl2 - multiplier * atr;

    upperBand = i === 0 ? newUpper : (newUpper < upperBand || candles[i - 1].close > upperBand ? newUpper : upperBand);
    lowerBand = i === 0 ? newLower : (newLower > lowerBand || candles[i - 1].close < lowerBand ? newLower : lowerBand);

    if (c.close > upperBand) dir = 1;
    else if (c.close < lowerBand) dir = -1;

    result.push({ direction: dir });
  }
  return result;
}

// ─── Volume Score ─────────────────────────────────────────────────────────────

function calcVolumeScore(candles: Candle[], lookback = 20): number {
  if (candles.length < lookback) return 50;
  const recent = candles.slice(-lookback);
  const avg = recent.reduce((s, c) => s + c.volume, 0) / lookback;
  const last = candles[candles.length - 1].volume;
  const ratio = avg > 0 ? last / avg : 1;
  return Math.min(100, Math.round(ratio * 50));
}

// ─── Late / overextended detection ───────────────────────────────────────────

function isOverextended(candles: Candle[], lookback = 12): boolean {
  if (candles.length < lookback) return false;
  const recent = candles.slice(-lookback);
  const low = Math.min(...recent.map(c => c.low));
  const high = Math.max(...recent.map(c => c.high));
  const last = candles[candles.length - 1].close;
  const pctFromLow = low > 0 ? (last - low) / low * 100 : 0;
  return pctFromLow > 15; // >15% from 12-bar low = overextended
}

// ─── Main Signal Engine ───────────────────────────────────────────────────────

export function analyzeSignal(symbol: string, timeframe: string, candles: Candle[]): SignalResult {
  const neutral: SignalResult = {
    signal: 'NEUTRAL', confidence: 0, risk: 'MEDIUM',
    reasons: ['Yetersiz veri — sinyal üretilemedi'],
    indicators: { utBot: 'NEUTRAL', superTrend: 'NEUTRAL', emaTrend: 'NEUTRAL', rsi: 50, atr: 0, volumeScore: 50 },
    marketRegime: { btcTrend: 'NEUTRAL', riskMode: 'NEUTRAL' }
  };

  if (candles.length < 60) return neutral;

  const closes = candles.map(c => c.close);
  const last = candles.length - 1;
  const price = closes[last];

  // Indicators
  const atrArr = calcATR(candles, 14);
  const atr = atrArr[last] ?? 0;
  const ema20Arr = calcEMA(closes, 20);
  const ema50Arr = calcEMA(closes, 50);
  const ema200Arr = calcEMA(closes, 200);
  const utArr = calcUTBot(candles, atrArr, 1);
  const stArr = calcSuperTrend(candles, atrArr, 3);
  const rsi = calcRSI(candles, 14);
  const volumeScore = calcVolumeScore(candles, 20);

  const ema20 = ema20Arr[last], ema50 = ema50Arr[last], ema200 = ema200Arr[last];
  const ut = utArr[last], st = stArr[last];

  const emaBull = ema20 > ema50 && price > ema50;
  const ema200Bull = price > (ema200 ?? price * 0.9);
  const stBull = st.direction === 1;
  const utBull = ut.direction === 1;
  const utPrepare = ut.prepare;
  const overextended = isOverextended(candles, 12);

  const emaTrend = emaBull ? 'BULL' : ema20 < ema50 ? 'BEAR' : 'NEUTRAL';
  const superTrendStr = stBull ? 'BULL' : st.direction === -1 ? 'BEAR' : 'NEUTRAL';
  const utBotStr = utBull ? (utPrepare ? 'PREPARE' : 'BUY') : ut.direction === -1 ? 'SELL' : 'NEUTRAL';

  // ─ Confidence scoring ─
  let confidence = 0;
  const reasons: string[] = [];

  // UT Bot (25 pts)
  if (utBull && utPrepare) { confidence += 20; reasons.push('UT Bot hazırlık sinyali verdi'); }
  else if (utBull) { confidence += 25; reasons.push('UT Bot yukarı yönde aktif'); }
  else if (ut.direction === -1) { confidence -= 10; reasons.push('UT Bot aşağı yönlü'); }

  // SuperTrend (20 pts)
  if (stBull) { confidence += 20; reasons.push('SuperTrend yükseliş trendi'); }
  else { confidence -= 5; reasons.push('SuperTrend düşüş trendi'); }

  // EMA Trend (15 pts)
  if (emaBull && ema200Bull) { confidence += 15; reasons.push('EMA trendi pozitif (20>50>200)'); }
  else if (emaBull) { confidence += 10; reasons.push('EMA kısa vadeli pozitif'); }
  else { confidence -= 5; reasons.push('EMA trendi negatif'); }

  // Volume (15 pts)
  if (volumeScore > 70) { confidence += 15; reasons.push('Hacim artışı var — setup destekliyor'); }
  else if (volumeScore > 50) { confidence += 8; reasons.push('Hacim normal seviyelerde'); }
  else { reasons.push('Hacim ortalamanın altında'); }

  // RSI / Momentum (10 pts)
  if (rsi < 30) { confidence += 10; reasons.push('RSI aşırı satış bölgesinde'); }
  else if (rsi > 50 && rsi < 70) { confidence += 8; reasons.push('RSI momentum pozitif'); }
  else if (rsi >= 70) { confidence -= 5; reasons.push('RSI aşırı alış bölgesinde'); }

  // Market Regime placeholder (15 pts) — full BTC regime needs separate call
  // Here we give neutral bonus
  confidence += 10;

  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  // ─ Risk level ─
  const atrPct = price > 0 ? (atr / price) * 100 : 0;
  const risk: RiskLevel = atrPct > 3 ? 'HIGH' : atrPct > 1.5 ? 'MEDIUM' : 'LOW';

  // ─ Trade plan (ATR-based) ─
  const stopLoss = price - atr * 2;
  const tp1 = price + atr * 2;
  const tp2 = price + atr * 4;
  const tp3 = price + atr * 6;
  const entryZone = { from: price - atr * 0.3, to: price + atr * 0.3 };

  // ─ Signal classification ─
  let signal: SignalType = 'NEUTRAL';

  if (overextended || rsi >= 75 || ut.direction === -1) {
    signal = 'AVOID';
    reasons.push('Geç kalınmış olabilir — giriş riski yüksek');
    confidence = Math.max(0, confidence - 20);
  } else if (confidence >= 75 && utBull && stBull && emaBull) {
    signal = 'CONFIRMED_BUY';
    reasons.push('Birden fazla indikatör onay verdi — giriş izlenebilir');
  } else if (confidence >= 60 && (utBull || stBull) && emaBull) {
    signal = 'EARLY_ENTRY';
    reasons.push('Erken giriş bölgesi — risk/ödül izlenebilir');
  } else if (confidence >= 45 && utPrepare) {
    signal = 'PREPARE';
    reasons.push('Hazırlık formasyonu oluşuyor — takip edilebilir');
  } else if (st.direction === -1 && ut.direction === -1) {
    signal = 'EXIT';
    reasons.push('Trend bozuldu — çıkış sinyali');
  }

  return {
    signal,
    confidence,
    risk,
    entryZone,
    stopLoss,
    takeProfits: [tp1, tp2, tp3],
    reasons,
    indicators: {
      utBot: utBotStr,
      superTrend: superTrendStr,
      emaTrend,
      rsi: Math.round(rsi * 10) / 10,
      atr: Math.round(atr * 10000) / 10000,
      volumeScore
    },
    marketRegime: {
      btcTrend: 'NEUTRAL',
      riskMode: 'NEUTRAL'
    }
  };
}
