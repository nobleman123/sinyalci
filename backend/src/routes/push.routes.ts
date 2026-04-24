import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db/prisma';
import { getVapidPublicKey, sendTestPush } from '../services/push.service';

export const pushRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/push/vapid-public-key
  fastify.get('/vapid-public-key', async (_req, reply) => {
    const key = getVapidPublicKey();
    if (!key) return reply.code(503).send({ error: 'VAPID not configured' });
    return { publicKey: key };
  });

  // POST /api/push/subscribe
  fastify.post('/subscribe', async (req, reply) => {
    const { userId, subscription, userAgent, platform } =
      req.body as { userId: string; subscription: any; userAgent?: string; platform?: string };
    if (!userId || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return reply.code(400).send({ error: 'Missing required fields' });
    }
    const sub = await prisma.pushSubscription.upsert({
      where:  { endpoint: subscription.endpoint },
      update: { userId, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, isActive: true, userAgent, platform },
      create: { userId, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, userAgent, platform },
    });
    return reply.code(201).send({ subscriptionId: sub.id });
  });

  // POST /api/push/unsubscribe
  fastify.post('/unsubscribe', async (req, reply) => {
    const { endpoint } = req.body as { endpoint: string };
    if (!endpoint) return reply.code(400).send({ error: 'Missing endpoint' });
    await prisma.pushSubscription.updateMany({
      where:  { endpoint },
      data:   { isActive: false },
    });
    return { ok: true };
  });

  // POST /api/push/test
  fastify.post('/test', async (req, reply) => {
    const { userId } = req.body as { userId: string };
    if (!userId) return reply.code(400).send({ error: 'Missing userId' });
    const result = await sendTestPush(userId);
    if (result.sent === 0) return reply.code(404).send({ error: 'No active subscriptions or VAPID not configured' });
    return { ok: true, ...result };
  });
};
