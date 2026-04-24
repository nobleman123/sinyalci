import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db/prisma';

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/settings/:userId
  fastify.get<{ Params: { userId: string } }>('/:userId', async (req, reply) => {
    const settings = await prisma.userSignalSettings.findUnique({
      where: { userId: req.params.userId },
    });
    if (!settings) return reply.code(404).send({ error: 'Settings not found' });
    return settings;
  });

  // PUT /api/settings/:userId
  fastify.put<{ Params: { userId: string }; Body: Record<string, unknown> }>(
    '/:userId', async (req, reply) => {
      const {
        universeMode, symbols, excludedSymbols, timeframes, mode,
        minConfidence, minSeq, minRR, maxLateRisk, minConfirmations,
        onlyClosedCandle, onlyAPlus, allowPrepAlerts, allowPullbackAlerts,
        allowLateWarnings, allowSleepingAlerts, cooldownMinutes,
        useMarketRegimeFilter, useDerivativesFilter, indicators, minMatch,
      } = req.body as any;

      const settings = await prisma.userSignalSettings.upsert({
        where:  { userId: req.params.userId },
        update: {
          ...(universeMode          != null && { universeMode }),
          ...(symbols               != null && { symbols }),
          ...(excludedSymbols       != null && { excludedSymbols }),
          ...(timeframes            != null && { timeframes: JSON.stringify(timeframes) }),
          ...(indicators            != null && { indicators: JSON.stringify(indicators) }),
          ...(minMatch              != null && { minMatch: parseInt(minMatch) }),
          ...(mode                  != null && { mode }),
          ...(minConfidence         != null && { minConfidence:     parseInt(minConfidence) }),
          ...(minSeq                != null && { minSeq:            parseInt(minSeq) }),
          ...(minRR                 != null && { minRR:             parseFloat(minRR) }),
          ...(maxLateRisk           != null && { maxLateRisk:       parseInt(maxLateRisk) }),
          ...(minConfirmations      != null && { minConfirmations:  parseInt(minConfirmations) }),
          ...(onlyClosedCandle      != null && { onlyClosedCandle:  Boolean(onlyClosedCandle) }),
          ...(onlyAPlus             != null && { onlyAPlus:         Boolean(onlyAPlus) }),
          ...(allowPrepAlerts       != null && { allowPrepAlerts:   Boolean(allowPrepAlerts) }),
          ...(allowPullbackAlerts   != null && { allowPullbackAlerts: Boolean(allowPullbackAlerts) }),
          ...(allowLateWarnings     != null && { allowLateWarnings: Boolean(allowLateWarnings) }),
          ...(allowSleepingAlerts   != null && { allowSleepingAlerts: Boolean(allowSleepingAlerts) }),
          ...(cooldownMinutes       != null && { cooldownMinutes:   parseInt(cooldownMinutes) }),
          ...(useMarketRegimeFilter != null && { useMarketRegimeFilter: Boolean(useMarketRegimeFilter) }),
          ...(useDerivativesFilter  != null && { useDerivativesFilter: Boolean(useDerivativesFilter) }),
        },
        create: { userId: req.params.userId },
      });
      return settings;
    }
  );
};
