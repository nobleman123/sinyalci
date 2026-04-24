import axios from 'axios';
import { env } from '../config/env';
import { redis, CacheKey, TTL } from './cache.service';

export interface FearGreedResult {
  value: number;
  valueText: string;
  timestamp: string;
}

export async function fetchFearGreed(): Promise<FearGreedResult | null> {
  // Try cache first
  const cached = await redis.get<FearGreedResult>(CacheKey.fearGreed());
  if (cached) return cached;

  try {
    const res = await axios.get<any>(env.FEAR_GREED_URL, {
      params: { limit: 1 },
      timeout: 8000,
    });
    const data = res.data?.data?.[0];
    if (!data) return null;

    const result: FearGreedResult = {
      value:     parseInt(data.value),
      valueText: data.value_classification,
      timestamp: data.timestamp,
    };

    await redis.set(CacheKey.fearGreed(), result, TTL.fearGreed);
    return result;
  } catch {
    return null;
  }
}
