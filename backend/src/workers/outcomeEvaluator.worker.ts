import cron from 'node-cron';
import { prisma } from '../db/prisma';
import { fetchKlines } from '../services/binance.service';
import { logger } from '../utils/logger';

// Evaluation window hours per timeframe
const EVAL_WINDOW: Record<string, number> = {
  '5m': 4, '15m': 12, '30m': 24,
  '1h': 72, '4h': 240, '6h': 336,
  '12h': 480, '1d': 720, '3d': 1440, '1w': 2016,
};

function getEvalWindowHours(tf: string): number {
  return EVAL_WINDOW[tf] ?? 72;
}

function buildComboKey(
  utDir: number, vrtDir: number, stDir: number,
  seqScore: number, marketRegime: string
): string {
  const parts: string[] = [];
  if (utDir !== 0)  parts.push('UT');
  if (vrtDir !== 0) parts.push('VRT');
  if (stDir !== 0)  parts.push('ST');
  if (seqScore >= 65) parts.push('SEQ');
  if (marketRegime !== 'MIXED') parts.push('MKT');
  return parts.sort().join('+') || 'NONE';
}

async function evaluateSignal(signalId: string): Promise<void> {
  const signal = await prisma.signalEvent.findUnique({
    where: { id: signalId },
    include: { outcome: true },
  });
  if (!signal || !signal.outcome) return;
  const outcome = signal.outcome;
  if (!['PENDING', 'ENTRY_TRIGGERED'].includes(outcome.status)) return;

  const tf = signal.timeframe;
  const evalWindowHours = getEvalWindowHours(tf);
  const expireTime = new Date(signal.candleCloseTime.getTime() + evalWindowHours * 60 * 60 * 1000);

  if (new Date() > expireTime && outcome.status === 'PENDING') {
    await prisma.signalOutcome.update({
      where: { id: outcome.id },
      data: { status: 'EXPIRED', expiredAt: new Date() },
    });
    return;
  }

  // Fetch candles after signal close time
  let candles: any[];
  try {
    candles = await fetchKlines(signal.symbol, tf, 100);
  } catch {
    return;
  }

  const signalCloseTs = signal.candleCloseTime.getTime();
  const afterCandles = candles.filter((c: any) => c.openTime > signalCloseTs);
  if (afterCandles.length === 0) return;

  const isLong = signal.direction === 'LONG';
  const { entryLow, entryHigh, stopLoss, tp1, tp2, tp3 } = signal;

  let newStatus = outcome.status;
  let entryTriggeredAt = outcome.entryTriggeredAt;
  let tp1HitAt = outcome.tp1HitAt;
  let tp2HitAt = outcome.tp2HitAt;
  let tp3HitAt = outcome.tp3HitAt;
  let stopHitAt = outcome.stopHitAt;
  let mfe = outcome.mfePercent;
  let mae = outcome.maePercent;
  let finalR = outcome.finalR;
  let barsToEntry = outcome.barsToEntry;
  let barsToTp1 = outcome.barsToTp1;
  let barsToStop = outcome.barsToStop;

  // ── n-bar returns
  const close3 = afterCandles[2]?.close;
  const close5 = afterCandles[4]?.close;
  const close10 = afterCandles[9]?.close;
  const basePrice = signal.entryHigh; // entry mid
  const r3  = close3  ? parseFloat((((close3  - basePrice) / basePrice * 100) * (isLong ? 1 : -1)).toFixed(4)) : 0;
  const r5  = close5  ? parseFloat((((close5  - basePrice) / basePrice * 100) * (isLong ? 1 : -1)).toFixed(4)) : 0;
  const r10 = close10 ? parseFloat((((close10 - basePrice) / basePrice * 100) * (isLong ? 1 : -1)).toFixed(4)) : 0;

  // ── Evaluate bar-by-bar
  for (let i = 0; i < afterCandles.length; i++) {
    const bar = afterCandles[i];
    const high = bar.high;
    const low  = bar.low;

    // MFE / MAE tracking (from entry price)
    const favExc = isLong ? ((high - basePrice) / basePrice) * 100 : ((basePrice - low) / basePrice) * 100;
    const advExc = isLong ? ((basePrice - low) / basePrice) * 100  : ((high - basePrice) / basePrice) * 100;
    if (favExc > mfe) mfe = parseFloat(favExc.toFixed(4));
    if (advExc > mae) mae = parseFloat(advExc.toFixed(4));

    // Entry check
    if (newStatus === 'PENDING') {
      const entryHit = isLong
        ? (low <= entryHigh && high >= entryLow)
        : (high >= entryLow && low <= entryHigh);

      if (entryHit) {
        newStatus = 'ENTRY_TRIGGERED';
        entryTriggeredAt = new Date(bar.openTime);
        barsToEntry = i + 1;
      } else {
        continue; // Don't check TP/SL before entry
      }
    }

    // TP / SL logic (conservative: SL first if same bar)
    if (isLong) {
      const slHit = low <= stopLoss;
      const tp1Hit = high >= tp1;
      if (slHit && !tp1HitAt) {
        newStatus = 'STOP_HIT';
        stopHitAt = new Date(bar.openTime);
        barsToStop = i + 1;
        finalR = -1;
        break;
      }
      if (tp1Hit && !tp1HitAt) {
        tp1HitAt = new Date(bar.openTime);
        barsToTp1 = i + 1;
        finalR = 1;
        if (newStatus === 'ENTRY_TRIGGERED') newStatus = 'TP1_HIT';
      }
      if (tp1HitAt && high >= tp2 && !tp2HitAt) {
        tp2HitAt = new Date(bar.openTime);
        finalR = 2;
        if (newStatus === 'TP1_HIT') newStatus = 'TP2_HIT';
      }
      if (tp2HitAt && high >= tp3 && !tp3HitAt) {
        tp3HitAt = new Date(bar.openTime);
        finalR = 3;
        newStatus = 'TP3_HIT';
        break;
      }
    } else {
      const slHit = high >= stopLoss;
      const tp1Hit = low <= tp1;
      if (slHit && !tp1HitAt) {
        newStatus = 'STOP_HIT';
        stopHitAt = new Date(bar.openTime);
        barsToStop = i + 1;
        finalR = -1;
        break;
      }
      if (tp1Hit && !tp1HitAt) {
        tp1HitAt = new Date(bar.openTime);
        barsToTp1 = i + 1;
        finalR = 1;
        if (newStatus === 'ENTRY_TRIGGERED') newStatus = 'TP1_HIT';
      }
      if (tp1HitAt && low <= tp2 && !tp2HitAt) {
        tp2HitAt = new Date(bar.openTime);
        finalR = 2;
        if (newStatus === 'TP1_HIT') newStatus = 'TP2_HIT';
      }
      if (tp2HitAt && low <= tp3 && !tp3HitAt) {
        tp3HitAt = new Date(bar.openTime);
        finalR = 3;
        newStatus = 'TP3_HIT';
        break;
      }
    }
  }

  // 24h / 72h return (approximate by candle count)
  const barsPerHour: Record<string, number> = {
    '5m': 12, '15m': 4, '30m': 2, '1h': 1, '4h': 0.25,
    '6h': 1/6, '12h': 1/12, '1d': 1/24,
  };
  const bph = barsPerHour[tf] ?? 1;
  const bars24 = Math.round(24 * bph);
  const bars72 = Math.round(72 * bph);
  const close24 = afterCandles[bars24]?.close;
  const close72 = afterCandles[bars72]?.close;
  const r24 = close24 ? parseFloat((((close24 - basePrice) / basePrice * 100) * (isLong ? 1 : -1)).toFixed(4)) : 0;
  const r72 = close72 ? parseFloat((((close72 - basePrice) / basePrice * 100) * (isLong ? 1 : -1)).toFixed(4)) : 0;

  // ATR-based R calculation
  const riskAmt = Math.abs(basePrice - stopLoss);
  const mfeR = riskAmt > 0 ? parseFloat((mfe / 100 * basePrice / riskAmt).toFixed(4)) : 0;
  const maeR = riskAmt > 0 ? parseFloat((mae / 100 * basePrice / riskAmt).toFixed(4)) : 0;

  await prisma.signalOutcome.update({
    where: { id: outcome.id },
    data: {
      status: newStatus,
      entryTriggeredAt: entryTriggeredAt ?? undefined,
      tp1HitAt: tp1HitAt ?? undefined,
      tp2HitAt: tp2HitAt ?? undefined,
      tp3HitAt: tp3HitAt ?? undefined,
      stopHitAt: stopHitAt ?? undefined,
      mfePercent: mfe, maePercent: mae,
      mfeR, maeR, finalR,
      barsToEntry, barsToTp1, barsToStop,
      returnAfter3Bars: r3, returnAfter5Bars: r5,
      returnAfter10Bars: r10, returnAfter24h: r24, returnAfter72h: r72,
    },
  });
}

export function startOutcomeEvaluatorWorker() {
  // Run every 15 minutes: check open outcomes
  cron.schedule('*/15 * * * *', async () => {
    try {
      const openOutcomes = await prisma.signalOutcome.findMany({
        where: { status: { in: ['PENDING', 'ENTRY_TRIGGERED'] } },
        select: { signalEventId: true },
        take: 50,
        orderBy: { createdAt: 'asc' },
      });

      for (const o of openOutcomes) {
        try {
          await evaluateSignal(o.signalEventId);
          await new Promise(r => setTimeout(r, 200)); // rate limit
        } catch (err: any) {
          logger.warn('Outcome eval error', { id: o.signalEventId, error: err.message });
        }
      }

      if (openOutcomes.length > 0) {
        logger.info(`Outcome evaluator: processed ${openOutcomes.length} signals`);
      }
    } catch (err: any) {
      logger.error('Outcome evaluator worker error', { error: err.message });
    }
  });

  logger.info('📊 Outcome Evaluator Worker started (every 15m)');
}
