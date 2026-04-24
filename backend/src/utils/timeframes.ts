/**
 * Timeframe utilities
 */

export const TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '3d', '1w'] as const;
export type Timeframe = typeof TIMEFRAMES[number];

/** Timeframe duration in milliseconds */
export const TF_MS: Record<Timeframe, number> = {
  '5m':  5  * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h':  60 * 60 * 1000,
  '4h':  4  * 60 * 60 * 1000,
  '6h':  6  * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1d':  24 * 60 * 60 * 1000,
  '3d':  3  * 24 * 60 * 60 * 1000,
  '1w':  7  * 24 * 60 * 60 * 1000,
};

/** Cache TTL = timeframe duration - 10 seconds (so we refresh after close) */
export function getCacheTTL(tf: Timeframe): number {
  return Math.max(TF_MS[tf] - 10_000, 60_000);
}

/** Check if a timeframe candle has just closed (within last 30 seconds) */
export function isTimeframeDue(tf: Timeframe, now: number = Date.now()): boolean {
  const ms = TF_MS[tf];
  const remainder = now % ms;
  return remainder < 30_000; // within first 30s after candle close
}

/** Next candle close time */
export function nextClose(tf: Timeframe, now: number = Date.now()): number {
  const ms = TF_MS[tf];
  return now + (ms - (now % ms));
}

/** Last candle close time */
export function lastClose(tf: Timeframe, now: number = Date.now()): number {
  const ms = TF_MS[tf];
  return now - (now % ms);
}

/** Binance interval string */
export function toBinanceInterval(tf: Timeframe): string {
  return tf; // already Binance format
}

export function isValidTimeframe(tf: string): tf is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(tf);
}
