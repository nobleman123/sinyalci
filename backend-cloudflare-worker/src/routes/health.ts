import { Hono } from 'hono';
import { Env } from '../types';
import { getSupabase } from '../services/supabase';

const health = new Hono<{ Bindings: Env }>();

health.get('/', async (c) => {
  let dbConnected = false;
  let dbError: string | null = null;

  try {
    const supabase = getSupabase(c.env);
    const { error } = await supabase.from('scan_state').select('id').limit(1);
    if (!error) dbConnected = true;
    else dbError = error.message;
  } catch (e: any) {
    dbError = e.message;
  }

  return c.json({
    ok: true,
    backend: 'cloudflare-worker',
    time: new Date().toISOString(),
    version: '1.0.0',
    dbConnected,
    dbError
  });
});

export default health;
