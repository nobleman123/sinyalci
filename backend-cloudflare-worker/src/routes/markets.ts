import { Hono } from 'hono';
import { Env } from '../types';
import { fetchTopVolumeMarkets } from '../services/binance';

const markets = new Hono<{ Bindings: Env }>();

markets.get('/top-volume', async (c) => {
  const limitStr = c.req.query('limit');
  const limit = limitStr ? Math.min(parseInt(limitStr), 100) : 50;

  try {
    const results = await fetchTopVolumeMarkets(c.env, limit);
    if (results.length === 0) {
      return c.json({ error: 'Could not fetch markets from Binance' }, 502);
    }
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default markets;
