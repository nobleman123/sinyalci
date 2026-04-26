import { Hono } from 'hono';
import { Env } from '../types';
import { getSupabase } from '../services/supabase';

const settings = new Hono<{ Bindings: Env }>();

const DEFAULT_USER_ID = 'default-user';

settings.get('/', async (c) => {
  const userId = c.req.query('userId') || DEFAULT_USER_ID;
  try {
    const supabase = getSupabase(c.env);
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return c.json({
        user_id: userId,
        watch_symbols: [],
        timeframes: ['5m', '15m', '1h', '4h'],
        min_confidence: 75,
        notify_prepare: true,
        notify_early_entry: true,
        notify_confirmed_buy: true,
        risk_filter: 'ALL',
        max_notifications_per_day: 20
      });
    }
    return c.json(data);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

settings.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const userId = body.userId || DEFAULT_USER_ID;
    const supabase = getSupabase(c.env);

    // Upsert settings
    const { data, error } = await supabase
      .from('user_settings')
      .upsert({
        user_id: userId,
        watch_symbols: body.watch_symbols ?? [],
        timeframes: body.timeframes ?? ['5m', '15m', '1h', '4h'],
        min_confidence: body.min_confidence ?? 75,
        notify_prepare: body.notify_prepare ?? true,
        notify_early_entry: body.notify_early_entry ?? true,
        notify_confirmed_buy: body.notify_confirmed_buy ?? true,
        risk_filter: body.risk_filter ?? 'ALL',
        max_notifications_per_day: body.max_notifications_per_day ?? 20,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (error) throw error;
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default settings;
