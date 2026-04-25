import webpush from 'web-push';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { prisma } from '../db/prisma';
import { SignalResult } from './signalEngine.service';

// Initialize VAPID keys if set
if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );
}

export function getVapidPublicKey(): string {
  return env.VAPID_PUBLIC_KEY;
}

export interface PushPayload {
  title:    string;
  body:     string;
  icon?:    string;
  badge?:   string;
  tag?:     string;
  data?:    Record<string, unknown>;
}

function buildNotificationPayload(signal: SignalResult): PushPayload {
  const dir = signal.direction === 'LONG' ? '📈 LONG' : signal.direction === 'SHORT' ? '📉 SHORT' : '👀 İZLE';
  const sigLabel: Record<string, string> = {
    CONSENSUS_BUY:  '🟢 KONSENSÜS AL',
    CONSENSUS_SELL: '🔴 KONSENSÜS SAT',
    QUALITY_BUY:    '🟢 KALİTELİ AL',
    QUALITY_SELL:   '🔴 KALİTELİ SAT',
    PULLBACK_LONG:  '🟡 PULLBACK BÖLGESİ',
    PULLBACK_SHORT: '🟡 PULLBACK BÖLGESİ',
    SLEEPING_LONG:  '🌙 Uyuyan Setup',
    SLEEPING_SHORT: '🌙 Uyuyan Setup',
    LATE_LONG:      '⚠️ GEÇ GİRİŞ RİSKİ',
    LATE_SHORT:     '⚠️ GEÇ GİRİŞ RİSKİ',
    WATCH_LONG:     '👀 İZLE — LONG',
    WATCH_SHORT:    '👀 İZLE — SHORT',
  };

  const title = `${signal.symbol} · ${signal.timeframe.toUpperCase()} · ${sigLabel[signal.signal] ?? signal.signal}`;

  const entry = `${signal.entryZone.low.toFixed(4)}–${signal.entryZone.high.toFixed(4)}`;
  let body = `${dir} · Güven: ${signal.confidence}% · Kalite: ${signal.quality} · R/R: ${signal.rr}x\n`;
  body += `📥 Giriş: ${entry}\n`;
  body += `🎯 TP1: ${signal.tp1.toFixed(4)}  TP2: ${signal.tp2.toFixed(4)}  TP3: ${signal.tp3.toFixed(4)}\n`;
  body += `🛡 Stop: ${signal.stopLoss.toFixed(4)}`;
  if (signal.reasons.length > 0) {
    body += `\n💡 ${signal.reasons.slice(0, 2).join(' · ')}`;
  }

  // Android titreşim: LONG = kısa, SHORT = uzun
  const vibrate = signal.direction === 'LONG'
    ? [200, 100, 200]
    : [500, 200, 500, 200, 500];

  return {
    title,
    body,
    tag:   `${signal.symbol}-${signal.timeframe}-${signal.signal}`,
    icon:  '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: {
      symbol:    signal.symbol,
      timeframe: signal.timeframe,
      signal:    signal.signal,
      direction: signal.direction,
      tp1:       signal.tp1,
      tp2:       signal.tp2,
      tp3:       signal.tp3,
      stopLoss:  signal.stopLoss,
      entryLow:  signal.entryZone.low,
      entryHigh: signal.entryZone.high,
      vibrate,
      url: `/?symbol=${signal.symbol}&tf=${signal.timeframe}`,
    },
  };
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  signalEventId?: string
): Promise<{ sent: number; failed: number }> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    logger.warn('VAPID keys not configured — push skipped');
    return { sent: 0, failed: 0 };
  }

  const subs = await prisma.pushSubscription.findMany({
    where: { userId, isActive: true },
  });

  let sent = 0, failed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 6, urgency: 'high' }
      );
      sent++;

      if (signalEventId) {
        await prisma.alertDelivery.create({
          data: {
            signalEventId, userId,
            pushSubscriptionId: sub.id,
            status: 'SENT',
          },
        }).catch(() => {});
      }
    } catch (err: any) {
      failed++;
      logger.warn('Push send failed', { userId, endpoint: sub.endpoint, error: err.message });

      // Deactivate invalid subscriptions (410 = Gone)
      if (err.statusCode === 410 || err.statusCode === 404) {
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { isActive: false },
        }).catch(() => {});
      }

      if (signalEventId) {
        await prisma.alertDelivery.create({
          data: {
            signalEventId, userId,
            pushSubscriptionId: sub.id,
            status: 'FAILED',
            error: err.message,
          },
        }).catch(() => {});
      }
    }
  }

  return { sent, failed };
}

export async function sendSignalPush(userId: string, signal: SignalResult, signalEventId?: string) {
  const payload = buildNotificationPayload(signal);
  return sendPushToUser(userId, payload, signalEventId);
}

export async function sendTestPush(userId: string): Promise<{ sent: number; failed: number }> {
  return sendPushToUser(userId, {
    title: '✅ NEXUS Test Bildirimi',
    body:  'Push notification sistemi başarıyla çalışıyor!',
    tag:   'test',
    data:  { url: '/' },
  });
}
