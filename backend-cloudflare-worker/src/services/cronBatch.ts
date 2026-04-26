import { Env } from '../types';
import { fetchTopVolumeMarkets, fetchCandles } from './binance';
import { analyzeSignal } from './signalEngine';
import { getSupabase } from './supabase';

const BATCH_SIZE = 10; // coins per cron run
const SCAN_TIMEFRAMES = ['5m', '15m', '1h', '4h'];

export async function runCronBatch(env: Env): Promise<void> {
  const supabase = getSupabase(env);

  // 1. Get or create scan cursor
  const { data: stateRow } = await supabase
    .from('scan_state')
    .select('*')
    .eq('key', 'cron_cursor')
    .single();

  let cursor = (stateRow?.value as any)?.cursor ?? 0;

  // 2. Get top 50 symbols
  const symbols = await fetchTopVolumeMarkets(env, 50);
  if (symbols.length === 0) {
    console.error('[CRON] No symbols fetched from Binance');
    return;
  }

  // 3. Slice batch
  const batchSymbols = symbols.slice(cursor, cursor + BATCH_SIZE);
  const nextCursor = cursor + BATCH_SIZE >= symbols.length ? 0 : cursor + BATCH_SIZE;

  console.log(`[CRON] Scanning batch ${cursor}-${cursor + BATCH_SIZE - 1} of ${symbols.length}`);

  const signalsToInsert: any[] = [];

  for (const symbol of batchSymbols) {
    for (const tf of SCAN_TIMEFRAMES) {
      try {
        const candles = await fetchCandles(env, symbol, tf, 200);
        if (candles.length < 60) continue;

        const result = analyzeSignal(symbol, tf, candles);
        const price = candles[candles.length - 1]?.close ?? 0;

        // Only save meaningful signals
        if (['PREPARE', 'EARLY_ENTRY', 'CONFIRMED_BUY'].includes(result.signal) && result.confidence >= 65) {
          signalsToInsert.push({
            symbol,
            timeframe: tf,
            signal_type: result.signal,
            confidence: result.confidence,
            risk: result.risk,
            entry_from: result.entryZone?.from ?? null,
            entry_to: result.entryZone?.to ?? null,
            stop_loss: result.stopLoss ?? null,
            tp1: result.takeProfits?.[0] ?? null,
            tp2: result.takeProfits?.[1] ?? null,
            tp3: result.takeProfits?.[2] ?? null,
            price_at_signal: price,
            reasons: result.reasons,
            indicators: result.indicators,
            market_regime: result.marketRegime,
            source: 'cron'
          });
        }
      } catch (err) {
        console.error(`[CRON] Error scanning ${symbol}/${tf}:`, err);
      }
    }
  }

  // 4. Bulk insert signals
  if (signalsToInsert.length > 0) {
    const { error } = await supabase.from('signals').insert(signalsToInsert);
    if (error) console.error('[CRON] DB insert error:', error.message);
    else console.log(`[CRON] Inserted ${signalsToInsert.length} signals`);
  }

  // 5. Update cursor
  await supabase.from('scan_state').upsert(
    { key: 'cron_cursor', value: { cursor: nextCursor, lastRun: new Date().toISOString(), signalsFound: signalsToInsert.length }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );

  console.log(`[CRON] Done. Next cursor: ${nextCursor}`);
}
