import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface Candle {
  time: number;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  takerBuyBase: number;
  takerBuyQuote: number;
  isClosed: boolean;
}

export interface Ticker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
  count: string;
  openPrice: string;
}

export interface FundingRate {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
}

const http: AxiosInstance = axios.create({
  baseURL: env.BINANCE_FAPI_BASE,
  timeout: 12000,
  headers: { 'Content-Type': 'application/json' },
});

const dataHttp: AxiosInstance = axios.create({
  baseURL: env.BINANCE_FAPI_DATA,
  timeout: 12000,
});

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 500): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === retries - 1) throw err;
      const wait = delayMs * Math.pow(2, attempt);
      logger.warn(`Binance API retry ${attempt + 1}/${retries} after ${wait}ms`, { error: err?.message });
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error('Max retries exceeded');
}

/**
 * Fetch OHLCV klines from Binance Futures.
 * closedOnly=true removes the last (open) candle.
 */
export async function fetchKlines(
  symbol: string,
  interval: string,
  limit = 520,
  closedOnly = true
): Promise<Candle[]> {
  return withRetry(async () => {
    const res = await http.get<any[][]>('/klines', {
      params: { symbol, interval, limit },
    });
    const now = Date.now();
    const candles: Candle[] = res.data.map(k => ({
      time:         Math.floor(Number(k[0]) / 1000),
      openTime:     Number(k[0]),
      closeTime:    Number(k[6]),
      open:         Number(k[1]),
      high:         Number(k[2]),
      low:          Number(k[3]),
      close:        Number(k[4]),
      volume:       Number(k[5]),
      quoteVolume:  Number(k[7] ?? 0),
      trades:       Number(k[8] ?? 0),
      takerBuyBase: Number(k[9] ?? 0),
      takerBuyQuote:Number(k[10] ?? 0),
      isClosed:     Number(k[6]) < now,
    }));
    // Critical: remove open candle to avoid repainting
    if (closedOnly && candles.length > 0 && !candles[candles.length - 1].isClosed) {
      candles.pop();
    }
    return candles;
  });
}

/** Fetch 24h ticker for a single symbol */
export async function fetchTicker24h(symbol: string): Promise<Ticker24h | null> {
  try {
    const res = await http.get<Ticker24h>('/ticker/24hr', { params: { symbol } });
    return res.data;
  } catch {
    return null;
  }
}

/** Fetch all USDT perp tickers, sorted by volume */
export async function fetchAllTickers(): Promise<Ticker24h[]> {
  return withRetry(async () => {
    const res = await http.get<Ticker24h[]>('/ticker/24hr');
    return res.data
      .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('_'))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
  });
}

/** Fetch latest funding rate for a symbol */
export async function fetchFundingRate(symbol: string): Promise<number | null> {
  try {
    const res = await http.get<FundingRate[]>('/fundingRate', {
      params: { symbol, limit: 1 },
    });
    if (res.data.length > 0) return parseFloat(res.data[0].fundingRate);
    return null;
  } catch {
    return null;
  }
}

/** Fetch open interest for a symbol */
export async function fetchOpenInterest(symbol: string): Promise<number | null> {
  try {
    const res = await http.get<{ openInterest: string }>('/openInterest', { params: { symbol } });
    return parseFloat(res.data.openInterest);
  } catch {
    return null;
  }
}

/** Fetch OI history for slope calculation */
export async function fetchOIHistory(symbol: string, period = '15m', limit = 12): Promise<number | null> {
  try {
    const res = await dataHttp.get<any[]>('/openInterestHist', {
      params: { symbol, period, limit },
    });
    if (!Array.isArray(res.data) || res.data.length < 2) return null;
    const first = parseFloat(res.data[0].sumOpenInterestValue || res.data[0].sumOpenInterest || '0');
    const last  = parseFloat(res.data.at(-1)!.sumOpenInterestValue || res.data.at(-1)!.sumOpenInterest || '0');
    return first ? ((last - first) / first) * 100 : null;
  } catch {
    return null;
  }
}

/** Batch fetch klines for multiple symbols with concurrency limit */
export async function batchFetchKlines(
  symbols: string[],
  interval: string,
  limit = 520,
  concurrency = 8
): Promise<Map<string, Candle[]>> {
  const results = new Map<string, Candle[]>();
  const chunks: string[][] = [];

  for (let i = 0; i < symbols.length; i += concurrency) {
    chunks.push(symbols.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    const settled = await Promise.allSettled(
      chunk.map(async symbol => {
        const candles = await fetchKlines(symbol, interval, limit);
        return { symbol, candles };
      })
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        results.set(r.value.symbol, r.value.candles);
      }
    }
    // Small delay to respect rate limits
    await new Promise(res => setTimeout(res, 100));
  }

  return results;
}
