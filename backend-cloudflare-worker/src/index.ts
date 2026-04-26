import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './types';
import { fetchCandles } from './services/binance';
import { analyzeSignal } from './services/signalEngine';

import health from './routes/health';
import markets from './routes/markets';
import signals from './routes/signals';
import scan from './routes/scan';
import settings from './routes/settings';
import notifications from './routes/notifications';
import performance from './routes/performance';

const app = new Hono<{ Bindings: Env }>();

// CORS — allow all origins (restrict in production)
app.use('/api/*', cors({
  origin: (origin) => {
    if (!origin) return '*';
    if (origin.startsWith('http://') || origin.startsWith('https://')) return origin;
    return '*';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Mount routes
app.route('/api/health', health);
app.route('/api/markets', markets);
app.route('/api/signals', signals);
app.route('/api/scan', scan);
app.route('/api/settings', settings);
app.route('/api/notifications', notifications);
app.route('/api/performance', performance);

// Single symbol signal endpoint
app.get('/api/signal', async (c) => {
  const symbol = c.req.query('symbol');
  const timeframe = c.req.query('timeframe') || '15m';

  if (!symbol) return c.json({ error: 'Missing symbol parameter' }, 400);

  try {
    const candles = await fetchCandles(c.env, symbol, timeframe, 200);
    if (candles.length === 0) {
      return c.json({ error: 'No candle data received from Binance' }, 502);
    }

    const signalResult = analyzeSignal(symbol, timeframe, candles);
    return c.json({
      symbol,
      timeframe,
      ...signalResult,
      createdAt: new Date().toISOString()
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Candle data endpoint (for frontend chart)
app.get('/api/candles', async (c) => {
  const symbol = c.req.query('symbol');
  const timeframe = c.req.query('timeframe') || '15m';
  const limitStr = c.req.query('limit') || '200';

  if (!symbol) return c.json({ error: 'Missing symbol' }, 400);

  try {
    const candles = await fetchCandles(c.env, symbol, timeframe, parseInt(limitStr));
    return c.json(candles);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log(`[CRON] Triggered at ${new Date(event.scheduledTime).toISOString()}`);
    // Batch scan logic — reads cursor from scan_state table
    try {
      const { runCronBatch } = await import('./services/cronBatch');
      await runCronBatch(env);
    } catch (err) {
      console.error('[CRON] Batch scan error:', err);
    }
  }
};
