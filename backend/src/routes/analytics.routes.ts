import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db/prisma';

// ── Helpers ──────────────────────────────────────────────────────────────────

function calcStats(outcomes: any[]) {
  const closed = outcomes.filter(o =>
    ['TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT', 'EXPIRED'].includes(o.status)
  );
  const total = closed.length;
  if (total === 0) return null;

  const tp1 = closed.filter(o => ['TP1_HIT', 'TP2_HIT', 'TP3_HIT'].includes(o.status)).length;
  const tp2 = closed.filter(o => ['TP2_HIT', 'TP3_HIT'].includes(o.status)).length;
  const tp3 = closed.filter(o => o.status === 'TP3_HIT').length;
  const stops = closed.filter(o => o.status === 'STOP_HIT').length;
  const avgR = closed.reduce((s: number, o: any) => s + (o.finalR || 0), 0) / total;
  const wins = tp1;
  const losses = stops;
  const profitFactor = losses === 0 ? avgR : (wins * Math.abs(avgR)) / losses;

  return {
    sampleSize:   total,
    tp1Rate:      parseFloat(((tp1 / total) * 100).toFixed(1)),
    tp2Rate:      parseFloat(((tp2 / total) * 100).toFixed(1)),
    tp3Rate:      parseFloat(((tp3 / total) * 100).toFixed(1)),
    stopRate:     parseFloat(((stops / total) * 100).toFixed(1)),
    winRate:      parseFloat(((wins / total) * 100).toFixed(1)),
    avgR:         parseFloat(avgR.toFixed(3)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

export const analyticsRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /api/analytics/overview?userId=...
  fastify.get<{ Querystring: { userId?: string } }>('/overview', async (req) => {
    const { userId } = req.query;
    const where = userId ? { userId } : {};

    const outcomes = await prisma.signalOutcome.findMany({
      where: userId ? { signalEvent: { userId } } : {},
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const stats = calcStats(outcomes);
    if (!stats) return { stats: null, message: 'Henüz yeterli veri yok (min. 10 kapanmış sinyal gerekli).' };

    // Best timeframe
    const tfGroups: Record<string, any[]> = {};
    for (const o of outcomes) {
      if (!tfGroups[o.timeframe]) tfGroups[o.timeframe] = [];
      tfGroups[o.timeframe].push(o);
    }
    let bestTf = '', bestTfRate = 0;
    for (const [tf, list] of Object.entries(tfGroups)) {
      const s = calcStats(list);
      if (s && s.tp1Rate > bestTfRate) { bestTfRate = s.tp1Rate; bestTf = tf; }
    }

    // Best symbol
    const symGroups: Record<string, any[]> = {};
    for (const o of outcomes) {
      if (!symGroups[o.symbol]) symGroups[o.symbol] = [];
      symGroups[o.symbol].push(o);
    }
    let bestSym = '', bestSymRate = 0;
    for (const [sym, list] of Object.entries(symGroups)) {
      const s = calcStats(list);
      if (s && s.tp1Rate > bestSymRate && s.sampleSize >= 3) { bestSymRate = s.tp1Rate; bestSym = sym; }
    }

    // Best combo
    const snapshots = await prisma.indicatorSnapshot.findMany({
      where: userId ? { signalEvent: { userId } } : {},
      take: 500,
    });
    const comboGroups: Record<string, string[]> = {};
    for (const snap of snapshots) {
      if (!comboGroups[snap.activeComboKey]) comboGroups[snap.activeComboKey] = [];
      comboGroups[snap.activeComboKey].push(snap.signalEventId);
    }
    let bestCombo = '', bestComboRate = 0;
    for (const [combo, ids] of Object.entries(comboGroups)) {
      const comboOutcomes = outcomes.filter(o => ids.includes(o.signalEventId));
      const s = calcStats(comboOutcomes);
      if (s && s.tp1Rate > bestComboRate && s.sampleSize >= 3) { bestComboRate = s.tp1Rate; bestCombo = combo; }
    }

    return {
      stats: {
        ...stats,
        bestTimeframe: bestTf || '—',
        bestSymbol: bestSym || '—',
        bestCombo: bestCombo || '—',
      }
    };
  });

  // ── GET /api/analytics/signals?userId=...&symbol=...&tf=...&status=...&limit=50
  fastify.get<{
    Querystring: { userId?: string; symbol?: string; tf?: string; status?: string; limit?: string }
  }>('/signals', async (req) => {
    const { userId, symbol, tf, status, limit = '50' } = req.query;
    const take = Math.min(parseInt(limit), 200);

    const signals = await prisma.signalEvent.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(symbol ? { symbol: symbol.toUpperCase() } : {}),
        ...(tf     ? { timeframe: tf } : {}),
      },
      include: {
        outcome:  true,
        snapshot: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    const filtered = status
      ? signals.filter((s: any) => s.outcome?.status === status)
      : signals;

    return { signals: filtered, total: filtered.length };
  });

  // ── GET /api/analytics/indicators?userId=...&symbol=...&tf=...
  fastify.get<{ Querystring: { userId?: string; symbol?: string; tf?: string } }>(
    '/indicators', async (req) => {
      const { userId, symbol, tf } = req.query;

      const outcomes = await prisma.signalOutcome.findMany({
        where: {
          ...(symbol ? { symbol: symbol.toUpperCase() } : {}),
          ...(tf     ? { timeframe: tf } : {}),
          ...(userId ? { signalEvent: { userId } } : {}),
        },
        include: { signalEvent: { include: { snapshot: true } } },
        take: 500,
      });

      const indNames = ['UT', 'VRT', 'ST', 'EMA', 'SEQ'];
      const results = indNames.map(ind => {
        const relevant = outcomes.filter((o: any) => {
          const snap = o.signalEvent?.snapshot;
          if (!snap) return false;
          if (ind === 'UT')  return snap.utDirection  !== 0;
          if (ind === 'VRT') return snap.vrtDirection !== 0;
          if (ind === 'ST')  return snap.stDirection  !== 0;
          if (ind === 'EMA') return snap.emaTrend     !== 0;
          if (ind === 'SEQ') return snap.seqScore     >= 65;
          return false;
        });

        const stats = calcStats(relevant);
        return {
          indicatorName: ind,
          sampleSize: stats?.sampleSize ?? 0,
          tp1Rate:    stats?.tp1Rate    ?? 0,
          stopRate:   stats?.stopRate   ?? 0,
          avgR:       stats?.avgR       ?? 0,
          winRate:    stats?.winRate    ?? 0,
          profitFactor: stats?.profitFactor ?? 0,
          recommendation: stats
            ? (stats.tp1Rate >= 60 ? '✅ Güvenilir filtre' : stats.tp1Rate >= 45 ? '⚠️ Orta başarı' : '❌ Tek başına zayıf')
            : 'Veri yetersiz',
        };
      });

      return { indicators: results };
    }
  );

  // ── GET /api/analytics/combinations?userId=...&symbol=...&tf=...
  fastify.get<{ Querystring: { userId?: string; symbol?: string; tf?: string } }>(
    '/combinations', async (req) => {
      const { userId, symbol, tf } = req.query;

      const snapshots = await prisma.indicatorSnapshot.findMany({
        where: {
          ...(symbol ? { symbol: symbol.toUpperCase() } : {}),
          ...(tf     ? { timeframe: tf } : {}),
          ...(userId ? { signalEvent: { userId } } : {}),
        },
        include: { signalEvent: { include: { outcome: true } } },
        take: 500,
      });

      const comboMap: Record<string, any[]> = {};
      for (const snap of snapshots) {
        const key = snap.activeComboKey || 'NONE';
        if (!comboMap[key]) comboMap[key] = [];
        comboMap[key].push(snap.signalEvent?.outcome);
      }

      const results = Object.entries(comboMap)
        .filter(([, outs]) => outs.filter(Boolean).length >= 2)
        .map(([combo, outcomes]) => {
          const validOutcomes = outcomes.filter(Boolean);
          const stats = calcStats(validOutcomes);
          return {
            comboKey:   combo,
            comboName:  combo.replace(/\+/g, ' + '),
            sampleSize: stats?.sampleSize ?? 0,
            tp1Rate:    stats?.tp1Rate    ?? 0,
            tp2Rate:    stats?.tp2Rate    ?? 0,
            stopRate:   stats?.stopRate   ?? 0,
            avgR:       stats?.avgR       ?? 0,
            profitFactor: stats?.profitFactor ?? 0,
            winRate:    stats?.winRate    ?? 0,
            recommendation: stats
              ? (stats.tp1Rate >= 60 ? '✅ En verimli kombinasyon' : stats.tp1Rate >= 45 ? '⚠️ Kabul edilebilir' : '❌ Yüksek false signal')
              : 'Veri yetersiz',
          };
        })
        .sort((a, b) => b.tp1Rate - a.tp1Rate);

      return { combinations: results };
    }
  );

  // ── GET /api/analytics/timeframes?userId=...&symbol=...
  fastify.get<{ Querystring: { userId?: string; symbol?: string } }>(
    '/timeframes', async (req) => {
      const { userId, symbol } = req.query;

      const outcomes = await prisma.signalOutcome.findMany({
        where: {
          ...(symbol ? { symbol: symbol.toUpperCase() } : {}),
          ...(userId ? { signalEvent: { userId } } : {}),
        },
        take: 1000,
      });

      const tfOrder = ['5m','15m','30m','1h','4h','6h','12h','1d','3d','1w'];
      const tfGroups: Record<string, any[]> = {};
      for (const o of outcomes) {
        if (!tfGroups[o.timeframe]) tfGroups[o.timeframe] = [];
        tfGroups[o.timeframe].push(o);
      }

      const results = tfOrder
        .filter(tf => tfGroups[tf]?.length > 0)
        .map(tf => {
          const list = tfGroups[tf] || [];
          const stats = calcStats(list);
          // Noise score: higher false-signal rate = higher noise
          const noiseScore = stats ? Math.round(100 - stats.tp1Rate) : 50;
          const rec = !stats ? 'Veri yetersiz'
            : stats.tp1Rate >= 60 ? '✅ Ana timeframe olarak önerilir'
            : stats.tp1Rate >= 48 ? '⚠️ Dikkatli kullan, A+ filtresi ekle'
            : '❌ Çok gürültülü — sadece HTF onayıyla kullan';

          return {
            timeframe:   tf,
            signalCount: list.length,
            sampleSize:  stats?.sampleSize ?? 0,
            tp1Rate:     stats?.tp1Rate    ?? 0,
            tp2Rate:     stats?.tp2Rate    ?? 0,
            stopRate:    stats?.stopRate   ?? 0,
            avgR:        stats?.avgR       ?? 0,
            winRate:     stats?.winRate    ?? 0,
            noiseScore,
            recommendation: rec,
          };
        });

      return { timeframes: results };
    }
  );

  // ── GET /api/analytics/coins?userId=...
  fastify.get<{ Querystring: { userId?: string } }>('/coins', async (req) => {
    const { userId } = req.query;

    const outcomes = await prisma.signalOutcome.findMany({
      where: userId ? { signalEvent: { userId } } : {},
      take: 1000,
    });

    const symGroups: Record<string, any[]> = {};
    for (const o of outcomes) {
      if (!symGroups[o.symbol]) symGroups[o.symbol] = [];
      symGroups[o.symbol].push(o);
    }

    const results = Object.entries(symGroups)
      .filter(([, list]) => list.length >= 3)
      .map(([symbol, list]) => {
        const stats = calcStats(list);
        // Best timeframe for this coin
        const tfSub: Record<string, any[]> = {};
        for (const o of list) {
          if (!tfSub[o.timeframe]) tfSub[o.timeframe] = [];
          tfSub[o.timeframe].push(o);
        }
        let bestTf = '', bestRate = 0;
        for (const [tf, tList] of Object.entries(tfSub)) {
          const s = calcStats(tList);
          if (s && s.tp1Rate > bestRate) { bestRate = s.tp1Rate; bestTf = tf; }
        }

        return {
          symbol,
          sampleSize: stats?.sampleSize ?? 0,
          winRate:    stats?.winRate    ?? 0,
          tp1Rate:    stats?.tp1Rate    ?? 0,
          avgR:       stats?.avgR       ?? 0,
          stopRate:   stats?.stopRate   ?? 0,
          bestTimeframe: bestTf || '—',
          recommendation: !stats ? 'Veri yetersiz'
            : stats.tp1Rate >= 62 ? '✅ İyi performans'
            : stats.tp1Rate >= 45 ? '⚠️ Orta — A+ filtresi ekle'
            : '❌ Yüksek false signal — watchlist\'e al',
        };
      })
      .sort((a, b) => b.tp1Rate - a.tp1Rate);

    return { coins: results };
  });

  // ── GET /api/analytics/recommendations?userId=...
  fastify.get<{ Querystring: { userId?: string } }>('/recommendations', async (req) => {
    const { userId } = req.query;
    const suggestions: any[] = [];

    const outcomes = await prisma.signalOutcome.findMany({
      where: userId ? { signalEvent: { userId } } : {},
      take: 500,
    });

    // Timeframe noise analysis
    const tfGroups: Record<string, any[]> = {};
    for (const o of outcomes) {
      if (!tfGroups[o.timeframe]) tfGroups[o.timeframe] = [];
      tfGroups[o.timeframe].push(o);
    }
    for (const [tf, list] of Object.entries(tfGroups)) {
      const s = calcStats(list);
      if (s && s.sampleSize >= 10 && s.tp1Rate < 45) {
        suggestions.push({
          type: 'TIMEFRAME_NOISE',
          severity: 'HIGH',
          title: `${tf} çok gürültülü`,
          description: `Son ${s.sampleSize} sinyalde TP1 oranı %${s.tp1Rate}. Sadece A+ bildirim veya devre dışı bırakma önerilir.`,
          proposedChange: { timeframe: tf, onlyAPlus: true },
        });
      }
    }

    // Coin-based high false-signal warning
    const symGroups: Record<string, any[]> = {};
    for (const o of outcomes) {
      if (!symGroups[o.symbol]) symGroups[o.symbol] = [];
      symGroups[o.symbol].push(o);
    }
    for (const [sym, list] of Object.entries(symGroups)) {
      const s = calcStats(list);
      if (s && s.sampleSize >= 5 && s.stopRate > 60) {
        suggestions.push({
          type: 'COIN_AVOID',
          severity: 'HIGH',
          title: `${sym} yüksek stop oranı`,
          description: `Son ${s.sampleSize} sinyalde stop oranı %${s.stopRate}. Watchlist'ten kaldırmayı düşünün.`,
          proposedChange: { excludeSymbol: sym },
        });
      }
    }

    // Overall confidence recommendation
    const overallStats = calcStats(outcomes);
    if (overallStats && overallStats.sampleSize >= 20 && overallStats.avgR < 0.5) {
      suggestions.push({
        type: 'SETTING_CHANGE',
        severity: 'MEDIUM',
        title: 'minConfidence yükseltilmeli',
        description: `Genel ortalama R: ${overallStats.avgR}. minConfidence 78'den 83'e çıkarmak sinyal kalitesini artırabilir.`,
        proposedChange: { minConfidence: 83 },
      });
    }

    return { suggestions };
  });
};
