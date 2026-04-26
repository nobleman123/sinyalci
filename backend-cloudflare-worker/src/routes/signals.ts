import { Hono } from 'hono';
import { Env } from '../types';
import { getSupabase } from '../services/supabase';

const signals = new Hono<{ Bindings: Env }>();

signals.get('/latest', async (c) => {
  const limitStr = c.req.query('limit') || '50';
  const limit = Math.min(parseInt(limitStr), 200);

  try {
    const supabase = getSupabase(c.env);
    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return c.json(data || []);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

signals.get('/history', async (c) => {
  const symbol = c.req.query('symbol');
  const timeframe = c.req.query('timeframe');

  if (!symbol || !timeframe) return c.json({ error: 'Missing symbol or timeframe' }, 400);

  try {
    const supabase = getSupabase(c.env);
    const { data, error } = await supabase
      .from('signals')
      .select('*, signal_outcomes(*)')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) throw error;
    return c.json(data || []);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default signals;
