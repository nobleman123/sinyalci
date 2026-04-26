import { Hono } from 'hono';
import { Env } from '../types';
import { getSupabase } from '../services/supabase';

const performance = new Hono<{ Bindings: Env }>();

performance.get('/indicators', async (c) => {
  const period = c.req.query('period') || '30d';
  try {
    const supabase = getSupabase(c.env);
    const { data, error } = await supabase
      .from('indicator_performance')
      .select('*')
      .eq('period', period)
      .order('win_rate', { ascending: false })
      .limit(20);

    if (error) throw error;

    // If no data yet, return empty
    if (!data || data.length === 0) {
      return c.json({
        period,
        message: 'Henüz yeterli sinyal geçmişi yok. Sistem çalıştıkça bu bölüm dolacak.',
        bestTimeframes: [],
        bestSymbols: [],
        indicators: []
      });
    }

    const indicators = data.map(row => ({
      name: row.indicator_combo,
      winRate: row.win_rate,
      signals: row.total_signals,
      avgReturn: row.avg_return,
      bestTimeframe: row.timeframe
    }));

    return c.json({ period, indicators });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default performance;
