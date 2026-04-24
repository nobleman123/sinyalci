import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default(''),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:3000'),

  BINANCE_FAPI_BASE: z.string().default('https://fapi.binance.com/fapi/v1'),
  BINANCE_FAPI_DATA: z.string().default('https://fapi.binance.com/futures/data'),

  FEAR_GREED_URL: z.string().default('https://api.alternative.me/fng/'),
  COINGECKO_BASE: z.string().default('https://api.coingecko.com/api/v3'),
  COINGECKO_API_KEY: z.string().default(''),

  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:admin@nexus-signal.app'),
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    result.error.issues.forEach(issue => {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
export type Env = typeof env;
