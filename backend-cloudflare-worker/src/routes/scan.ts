import { Hono } from 'hono';
import { Env } from '../types';
import { fetchCandles } from '../services/binance';
import { analyzeSignal } from '../services/signalEngine';
import { getSupabase } from '../services/supabase';

const scan = new Hono<{ Bindings: Env }>();

scan.post('/run', async (c) => {
  try {
    const body = await c.req.json();
    const symbols: string[] = body.symbols || [];
    const timeframes: string[] = body.timeframes || ['15m'];
    const minConfidence: number = body.minConfidence ?? 75;
    const signalTypes: string[] = body.signals || ['PREPARE', 'EARLY_ENTRY', 'CONFIRMED_BUY'];

    if (symbols.length === 0) return c.json({ error: 'No symbols provided' }, 400);
    if (symbols.length > 20) return c.json({ error: 'Max 20 symbols per request' }, 400);

    const results: any[] = [];
    const supabase = getSupabase(c.env);

    for (const symbol of symbols) {
      for (const tf of timeframes) {
        try {
          const candles = await fetchCandles(c.env, symbol, tf, 200);
          if (candles.length < 50) continue;

          const signalResult = analyzeSignal(symbol, tf, candles);
          const currentPrice = candles[candles.length - 1]?.close ?? 0;

          if (
            signalResult.confidence >= minConfidence &&
            signalTypes.includes(signalResult.signal) &&
            signalResult.signal !== 'NEUTRAL'
          ) {
            const row = {
              symbol,
              timeframe: tf,
              signal_type: signalResult.signal,
              confidence: signalResult.confidence,
              risk: signalResult.risk,
              entry_from: signalResult.entryZone?.from ?? null,
              entry_to: signalResult.entryZone?.to ?? null,
              stop_loss: signalResult.stopLoss ?? null,
              tp1: signalResult.takeProfits?.[0] ?? null,
              tp2: signalResult.takeProfits?.[1] ?? null,
              tp3: signalResult.takeProfits?.[2] ?? null,
              price_at_signal: currentPrice,
              reasons: signalResult.reasons,
              indicators: signalResult.indicators,
              market_regime: signalResult.marketRegime,
              source: 'manual-scan'
            };
            results.push(row);
          }
        } catch (err) {
          console.error(`Error scanning ${symbol}/${tf}:`, err);
        }
      }
    }

    // Save all qualifying signals to DB
    if (results.length > 0) {
      const { error } = await supabase.from('signals').insert(results);
      if (error) console.error('DB insert error:', error.message);
    }

    return c.json({
      scanned: symbols.length * timeframes.length,
      signalsFound: results.length,
      signals: results
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default scan;
