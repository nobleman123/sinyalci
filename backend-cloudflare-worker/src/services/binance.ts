import { Env, Candle } from '../types';

export const getBinanceBaseUrl = (env: Env) => env.BINANCE_BASE_URL || 'https://fapi.binance.com';

export const fetchTopVolumeMarkets = async (env: Env, limit: number = 50): Promise<string[]> => {
  try {
    const url = `${getBinanceBaseUrl(env)}/fapi/v1/ticker/24hr`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance API Error: ${res.statusText}`);
    
    const data: any[] = await res.json();
    
    // Filter for USDT perpetuals, sort by volume descending
    const filtered = data
      .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('_'))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
      
    return filtered.slice(0, limit).map(t => t.symbol);
  } catch (error) {
    console.error('Error fetching markets:', error);
    return [];
  }
};

export const fetchCandles = async (env: Env, symbol: string, timeframe: string, limit: number = 200): Promise<Candle[]> => {
  try {
    const url = `${getBinanceBaseUrl(env)}/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance API Error: ${res.statusText}`);
    
    const data: any[][] = await res.json();
    
    return data.map(k => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
  } catch (error) {
    console.error(`Error fetching candles for ${symbol}:`, error);
    return [];
  }
};
