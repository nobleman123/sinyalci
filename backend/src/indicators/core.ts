// ── ATR ──────────────────────────────────────────────────────────────
import { Candle } from '../services/binance.service';

export function calcATR(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < 2) return out;

  const tr = new Array(candles.length).fill(0);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low  - candles[i - 1].close);
    tr[i] = Math.max(hl, hc, lc);
  }

  let atr = tr.slice(0, period).reduce((a: number, b: number) => a + b, 0) / period;
  out[period - 1] = atr;
  for (let i = period; i < candles.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out[i] = atr;
  }
  return out;
}

// ── EMA ──────────────────────────────────────────────────────────────
export function calcEMA(values: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const clean = values.map(v => v ?? 0);
  if (clean.length < period) return out;

  const k = 2 / (period + 1);
  let ema = clean.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < clean.length; i++) {
    ema = clean[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

// ── RSI ──────────────────────────────────────────────────────────────
export function calcRSI(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  out[period] = 100 - 100 / (1 + (avgL === 0 ? 1e10 : avgG / avgL));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = 100 - 100 / (1 + (avgL === 0 ? 1e10 : avgG / avgL));
  }
  return out;
}

// ── MACD ─────────────────────────────────────────────────────────────
export function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaF = calcEMA(closes, fast);
  const emaS = calcEMA(closes, slow);
  const macd: (number | null)[] = closes.map((_, i) =>
    emaF[i] != null && emaS[i] != null ? emaF[i]! - emaS[i]! : null
  );
  const sig = calcEMA(macd.map(v => v ?? 0), signal);
  const hist: (number | null)[] = macd.map((v, i) =>
    v != null && sig[i] != null ? v - sig[i]! : null
  );
  return { macd, signal: sig, hist };
}

// ── VWAP ─────────────────────────────────────────────────────────────
export function calcVWAP(candles: Candle[]): (number | null)[] {
  const out: (number | null)[] = [];
  let cumTPV = 0, cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * c.volume;
    cumVol += c.volume;
    out.push(cumVol > 0 ? cumTPV / cumVol : null);
  }
  return out;
}

// ── Bollinger Bands ───────────────────────────────────────────────────
export interface BBResult {
  mid: number;
  upper: number;
  lower: number;
  width: number;
}

export function calcBB(closes: number[], period = 20, mult = 2): (BBResult | null)[] {
  const out: (BBResult | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mid = slice.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period);
    const upper = mid + mult * sd;
    const lower = mid - mult * sd;
    out[i] = { mid, upper, lower, width: (upper - lower) / Math.max(mid, 1e-9) };
  }
  return out;
}

export function calcBBPercentile(bb: (BBResult | null)[], lookback = 100): (number | null)[] {
  const out: (number | null)[] = new Array(bb.length).fill(null);
  for (let i = lookback; i < bb.length; i++) {
    const slice = bb.slice(i - lookback + 1, i + 1).filter((v): v is BBResult => v !== null);
    if (slice.length < lookback / 2) continue;
    const currentWidth = bb[i]!.width;
    const count = slice.filter(v => v.width < currentWidth).length;
    out[i] = (count / slice.length) * 100;
  }
  return out;
}

// ── ADX ──────────────────────────────────────────────────────────────
export function calcADX(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period * 2 + 2) return out;

  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const dn = candles[i - 1].low - candles[i].low;
    plusDM.push(up > dn && up > 0 ? up : 0);
    minusDM.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close)
    ));
  }

  const smooth = (arr: number[]): (number | null)[] => {
    const o: (number | null)[] = new Array(arr.length).fill(null);
    let v = arr.slice(0, period).reduce((a, b) => a + b, 0);
    o[period - 1] = v;
    for (let i = period; i < arr.length; i++) { v = v - v / period + arr[i]; o[i] = v; }
    return o;
  };

  const trS = smooth(tr), pS = smooth(plusDM), mS = smooth(minusDM);
  const dx: (number | null)[] = tr.map((_, i) => {
    if (!trS[i]) return null;
    const pDI = 100 * pS[i]! / trS[i]!;
    const mDI = 100 * mS[i]! / trS[i]!;
    return 100 * Math.abs(pDI - mDI) / Math.max(pDI + mDI, 1e-9);
  });

  const vals = dx.filter((v): v is number => v != null);
  if (vals.length < period) return out;
  let adx = vals.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let idx = period * 2 - 1;
  out[idx] = adx;
  for (let i = idx + 1; i < candles.length; i++) {
    const dxv = dx[i - 1];
    if (dxv == null) continue;
    adx = (adx * (period - 1) + dxv) / period;
    out[i] = adx;
  }
  return out;
}

// ── Stochastic ────────────────────────────────────────────────────────
export function calcStoch(candles: Candle[], period = 30): { k: (number|null)[], d: (number|null)[] } {
  const k: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const hh = Math.max(...slice.map(c => c.high));
    const ll = Math.min(...slice.map(c => c.low));
    k[i] = hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100;
  }
  const d = calcEMA(k.map(v => v ?? 50), 3);
  return { k, d };
}

// ── Relative Volume ────────────────────────────────────────────────────
export function calcRelativeVolume(candles: Candle[], period = 20): (number | null)[] {
  return candles.map((c, i) => {
    if (i < period) return null;
    const avg = candles.slice(i - period, i).reduce((a, b) => a + b.volume, 0) / period;
    return c.volume / Math.max(avg, 1e-9);
  });
}

// ── Heikin Ashi ───────────────────────────────────────────────────────
export function toHeikinAshi(candles: Candle[]): Candle[] {
  return candles.map((c, i) => {
    const close = (c.open + c.high + c.low + c.close) / 4;
    const open  = i === 0 ? (c.open + c.close) / 2 : (candles[i - 1].open + candles[i - 1].close) / 2;
    return { ...c, open, high: Math.max(c.high, open, close), low: Math.min(c.low, open, close), close };
  });
}

// ── Candle Quality ───────────────────────────────────────────────────
export interface CandleQuality {
  bodyRatio: number;
  upperWickRatio: number;
  lowerWickRatio: number;
}

export function getCandleQuality(c: Candle): CandleQuality {
  const fullRange = Math.max(c.high - c.low, 1e-9);
  const bodySize  = Math.abs(c.close - c.open);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;

  return {
    bodyRatio: bodySize / fullRange,
    upperWickRatio: upperWick / fullRange,
    lowerWickRatio: lowerWick / fullRange
  };
}

// ── Clamp ─────────────────────────────────────────────────────────────
export const clamp = (v: number, lo = 0, hi = 100): number => Math.min(hi, Math.max(lo, v));
