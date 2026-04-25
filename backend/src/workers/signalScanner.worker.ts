import cron from 'node-cron';
import { prisma } from '../db/prisma';
import { fetchKlines } from '../services/binance.service';
import { redis, CacheKey, TTL } from '../services/cache.service';
import { analyzeCandles, SignalResult, SignalType } from '../services/signalEngine.service';
import { getMarketHealth } from '../services/marketHealth.service';
import { sendSignalPush } from '../services/push.service';
import { logger } from '../utils/logger';
import { isValidTimeframe, isTimeframeDue, Timeframe } from '../utils/timeframes';

// Signals that warrant an immediate push notification
const NOTIFY_SIGNALS: SignalType[] = [
  'CONSENSUS_BUY', 'CONSENSUS_SELL',
  'QUALITY_BUY',   'QUALITY_SELL',
  'PULLBACK_LONG', 'PULLBACK_SHORT',
  'SLEEPING_LONG', 'SLEEPING_SHORT',
  'LATE_LONG',     'LATE_SHORT',
];

function shouldNotify(signal: SignalType, settings: any): boolean {
  if (['CONSENSUS_BUY','CONSENSUS_SELL'].includes(signal))  return true;
  if (['QUALITY_BUY','QUALITY_SELL'].includes(signal))      return true;
  if (['PULLBACK_LONG','PULLBACK_SHORT'].includes(signal))  return settings.allowPullbackAlerts;
  if (['SLEEPING_LONG','SLEEPING_SHORT'].includes(signal))  return settings.allowSleepingAlerts;
  if (['LATE_LONG','LATE_SHORT'].includes(signal))          return settings.allowLateWarnings;
  return false;
}

function meetsUserThresholds(result: SignalResult, settings: any): boolean {
  if (result.confidence < settings.minConfidence)   return false;
  if (result.seqScore   < settings.minSeq)          return false;
  if (result.rr         < settings.minRR)           return false;
  if (result.lateRisk   > settings.maxLateRisk)     return false;
  if (settings.onlyAPlus && !['A+', 'A'].includes(result.quality)) return false;

  // ── Indicator Matching ──
  const targetDir = result.direction === 'LONG' ? 1 : result.direction === 'SHORT' ? -1 : 0;
  if (targetDir === 0) return false;

  let matchCount = 0;
  let indicators: string[] = [];
  try { indicators = JSON.parse(settings.indicators); } catch {}
  if (!indicators || indicators.length === 0) indicators = ['UT','VRT','SUPER']; // default

  if (indicators.includes('UT') && result.rawIndicators.ut === targetDir) matchCount++;
  if (indicators.includes('VRT') && result.rawIndicators.vrt === targetDir) matchCount++;
  if (indicators.includes('SUPER') && result.rawIndicators.st === targetDir) matchCount++;
  if (indicators.includes('EMA') && result.rawIndicators.ema === targetDir) matchCount++;
  if (indicators.includes('AMC') && (targetDir === 1 ? result.rawIndicators.amc >= 55 : result.rawIndicators.amc <= 45)) matchCount++;
  if (indicators.includes('SEQ') && result.rawIndicators.seqScore >= 65) matchCount++;

  // Sleeping coin is an exception to the strict minMatch as it's a pre-breakout setup
  if (result.signal.includes('SLEEPING') && matchCount >= Math.max(1, settings.minMatch - 1)) return true;
  
  if (matchCount < settings.minMatch) return false;

  return true;
}

async function getSymbolsForUser(settings: any): Promise<string[]> {
  const mode: string = settings.universeMode;
  if (mode === 'WATCHLIST') {
    const wl = await prisma.watchlist.findMany({
      where: { userId: settings.userId, enabled: true },
      select: { symbol: true },
    });
    return wl.map((w: { symbol: string }) => w.symbol);
  }
  if (mode === 'CUSTOM' && settings.symbols) {
    try { return JSON.parse(settings.symbols).slice(0, 200); } catch { return []; }
  }
  // TOP_50 / TOP_100 / TOP_200
  const limit = mode === 'TOP_100' ? 100 : mode === 'TOP_200' ? 200 : 50;
  const cached = await redis.get<Array<{ symbol: string }>>(CacheKey.symbolUniverse());
  if (cached) return cached.slice(0, limit).map(c => c.symbol);
  return [];
}

export async function scanForUser(userId: string, force: boolean = false) {
  const settings = await prisma.userSignalSettings.findUnique({ where: { userId } });
  if (!settings) return;

  let timeframes: Timeframe[] = [];
  try { timeframes = JSON.parse(settings.timeframes).filter(isValidTimeframe); } catch {}
  
  const now = Date.now();

  // Only scan timeframes that have just closed (unless forced)
  const dueTimeframes = force ? timeframes : timeframes.filter(tf => isTimeframeDue(tf, now));
  if (dueTimeframes.length === 0) return;

  const symbols = await getSymbolsForUser(settings);
  if (symbols.length === 0) {
    logger.warn('No symbols found for user scan', { userId, mode: settings.universeMode });
    return;
  }

  const health = await getMarketHealth();
  let excluded: string[] = [];
  try { excluded = JSON.parse(settings.excludedSymbols); } catch {}

  logger.info(`Scanning ${symbols.length} symbols for user ${userId}`, { dueTimeframes });

  for (const tf of dueTimeframes) {
    for (const symbol of symbols) {
      if (excluded.includes(symbol)) continue;
      try {
        const cacheKey = CacheKey.analysis(symbol, tf);
        let result = await redis.get<SignalResult>(cacheKey);

        if (!result) {
          const candles = await fetchKlines(symbol, tf, 520);
          if (candles.length < 60) continue;
          result = analyzeCandles(candles, symbol, tf, health.marketRegime);
          await redis.set(cacheKey, result, TTL.klines(tf));
          await new Promise(r => setTimeout(r, 100));
        }

        if (!NOTIFY_SIGNALS.includes(result.signal)) continue;
        if (!shouldNotify(result.signal, settings))   continue;
        if (!meetsUserThresholds(result, settings))   continue;

        // Market regime suppression
        if (settings.useMarketRegimeFilter &&
            health.marketRegime === 'STRONG_RISK_OFF' &&
            result.direction === 'LONG') continue;

        // ── Duplicate check ──────────────────────────────────────────
        const dupKey = CacheKey.duplicate(
          `${userId}:${symbol}:${tf}:${result.signal}:${result.candleCloseTime}`
        );
        const isDup = await redis.exists(dupKey);
        if (isDup) continue;

        // ── Cooldown check ───────────────────────────────────────────
        const coolKey = CacheKey.cooldown(
          `${userId}:${symbol}:${tf}:${result.direction}`
        );
        const onCooldown = await redis.exists(coolKey);
        if (onCooldown) continue;

        // ── Save signal event ────────────────────────────────────────
        const dirStr = result.direction === 'LONG' ? 'UP' : result.direction === 'SHORT' ? 'DOWN' : 'NONE';
        const signalEvent = await prisma.signalEvent.create({
          data: {
            userId,
            symbol, timeframe: tf,
            signal:    result.signal,
            direction: result.direction,
            confidence:result.confidence,
            quality:   result.quality,
            seqScore:  result.seqScore,
            amcScore:  result.amcScore,
            lateRisk:  result.lateRisk,
            rr:        result.rr,
            entryLow:  result.entryZone.low,
            entryHigh: result.entryZone.high,
            stopLoss:  result.stopLoss,
            tp1: result.tp1, tp2: result.tp2, tp3: result.tp3,
            marketRegime: result.marketRegime,
            reasons: JSON.stringify(result.reasons),
            candleCloseTime: new Date(result.candleCloseTime),
            duplicateKey: `${userId}:${symbol}:${tf}:${result.signal}:${result.candleCloseTime}`,
          },
        }).catch(() => null);

        if (!signalEvent) continue; // duplicate key constraint caught

        // ── Save IndicatorSnapshot ────────────────────────────────────
        const comboKey = [
          result.rawIndicators.ut  !== 0 ? 'UT'  : '',
          result.rawIndicators.vrt !== 0 ? 'VRT' : '',
          result.rawIndicators.st  !== 0 ? 'ST'  : '',
          result.rawIndicators.seqScore >= 65 ? 'SEQ' : '',
          result.marketRegime !== 'MIXED' ? 'MKT' : '',
        ].filter(Boolean).sort().join('+') || 'NONE';

        await prisma.indicatorSnapshot.create({
          data: {
            signalEventId: signalEvent.id,
            symbol, timeframe: tf,
            direction:     result.direction,
            utDirection:   result.rawIndicators.ut,
            vrtDirection:  result.rawIndicators.vrt,
            stDirection:   result.rawIndicators.st,
            emaTrend:      result.rawIndicators.ema,
            amcScore:      result.rawIndicators.amc,
            seqScore:      result.rawIndicators.seqScore,
            lateRisk:      result.lateRisk,
            rr:            result.rr,
            marketRegime:  result.marketRegime,
            activeComboKey: comboKey,
          },
        }).catch(() => {});

        // ── Create SignalOutcome (PENDING) ────────────────────────────
        const evalWindowHrs: Record<string,number> = {
          '5m':4,'15m':12,'30m':24,'1h':72,'4h':240,
          '6h':336,'12h':480,'1d':720,'3d':1440,'1w':2016,
        };
        await prisma.signalOutcome.create({
          data: {
            signalEventId:        signalEvent.id,
            symbol, timeframe:    tf,
            direction:            result.direction,
            signal:               result.signal,
            entryLow:             result.entryZone.low,
            entryHigh:            result.entryZone.high,
            stopLoss:             result.stopLoss,
            tp1: result.tp1, tp2: result.tp2, tp3: result.tp3,
            candleCloseTime:      new Date(result.candleCloseTime),
            evaluationWindowHours: evalWindowHrs[tf] ?? 72,
            status: 'PENDING',
          },
        }).catch(() => {});

        // ── Set duplicate + cooldown TTL ─────────────────────────────
        const cooldownSec = settings.cooldownMinutes * 60;
        await redis.setNX(dupKey, '1', cooldownSec * 2);
        await redis.setNX(coolKey, '1', cooldownSec);

        // ── Send push ────────────────────────────────────────────────
        const { sent } = await sendSignalPush(userId, result, signalEvent.id);
        logger.info('Signal push sent', { userId, symbol, tf, signal: result.signal, sent });

      } catch (err: any) {
        logger.warn('Scan error', { userId, symbol, error: err.message });
      }
    }
  }
}

export function startSignalScannerWorker() {
  // Every minute: check which timeframes are due
  cron.schedule('* * * * *', async () => {
    try {
      const allSettings = await prisma.userSignalSettings.findMany({
        select: { userId: true },
      });

      // Scan each user independently
      logger.info(`💓 Scanner Heartbeat: Processing ${allSettings.length} active users`);
      await Promise.allSettled(
        allSettings.map((s: { userId: string }) => scanForUser(s.userId, false))
      );
    } catch (err: any) {
      logger.error('Signal scanner worker error', { error: err.message });
    }
  });

  logger.info('⚡ Signal Scanner Worker started (every 1m, timeframe-gated)');
}
