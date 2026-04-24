import Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { env } from '../config/env';
import { logger } from '../utils/logger';

let _client: Redis | RedisMock | null = null;

function getClient(): any {
  if (_client) return _client;
  if (!env.REDIS_URL) {
    _client = new RedisMock();
    logger.info('✅ Redis Mock connected (Local Mode)');
    return _client;
  }
  _client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    enableOfflineQueue: false,
  });
  _client.on('error', err => logger.error('Redis error', { error: err.message }));
  _client.on('connect', () => logger.info('✅ Redis connected'));
  return _client;
}

export const redis = {
  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      const val = await getClient().get(key);
      if (!val) return null;
      return JSON.parse(val) as T;
    } catch {
      return null;
    }
  },

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const str = JSON.stringify(value);
      if (ttlSeconds) {
        await getClient().setex(key, ttlSeconds, str);
      } else {
        await getClient().set(key, str);
      }
    } catch (err: any) {
      logger.warn('Redis set error', { key, error: err.message });
    }
  },

  async del(key: string): Promise<void> {
    try {
      await getClient().del(key);
    } catch {}
  },

  async exists(key: string): Promise<boolean> {
    try {
      return (await getClient().exists(key)) === 1;
    } catch {
      return false;
    }
  },

  async setNX(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    try {
      const result = await getClient().set(key, value, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch {
      return false;
    }
  },

  async getClient(): Promise<any> {
    return getClient();
  },

  async disconnect(): Promise<void> {
    if (_client) {
      await _client.quit();
      _client = null;
    }
  },
};

// ── CACHE KEYS ──────────────────────────────────────────────────────────────

export const CacheKey = {
  klines:        (symbol: string, tf: string) => `klines:${symbol}:${tf}`,
  analysis:      (symbol: string, tf: string) => `analysis:${symbol}:${tf}`,
  tickerAll:     () => 'ticker:all',
  marketHealth:  () => 'market:health',
  fearGreed:     () => 'market:feargreed',
  symbolUniverse:() => 'symbols:universe',
  duplicate:     (key: string)               => `dup:${key}`,
  cooldown:      (key: string)               => `cooldown:${key}`,
};

// ── TTL PRESETS ──────────────────────────────────────────────────────────────

export const TTL = {
  ticker:        30,
  marketHealth:  300,
  fearGreed:     3600,
  symbolUniverse:3600,
  klines: (tf: string): number => {
    const map: Record<string, number> = {
      '5m': 240, '15m': 840, '30m': 1740,
      '1h': 3540, '4h': 14340, '6h': 21540,
      '12h': 43140, '1d': 86340, '3d': 259140, '1w': 604740,
    };
    return map[tf] ?? 3540;
  },
};
