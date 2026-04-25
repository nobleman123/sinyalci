import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db/prisma';
import { v4 as uuidv4 } from 'uuid';

export const deviceRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/device/register
  fastify.post('/register', async (req, reply) => {
    const body = req.body as { userId?: string; deviceName?: string; email?: string } | undefined;
    const userId = body?.userId || uuidv4();
    
    const user = await prisma.user.upsert({
      where:  { id: userId },
      update: {
        deviceName: body?.deviceName ?? 'Unknown Device',
        email:      body?.email ?? null,
      },
      create: {
        id:         userId,
        deviceName: body?.deviceName ?? 'Unknown Device',
        email:      body?.email ?? null,
      },
    });

    // Ensure default settings exist
    await prisma.userSignalSettings.upsert({
      where:  { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    return reply.code(200).send({ userId: user.id, createdAt: user.createdAt });
  });
  // POST /api/device/scan
  fastify.post('/scan', async (req, reply) => {
    const body = req.body as { userId?: string } | undefined;
    if (!body?.userId) return reply.code(400).send({ error: 'userId required' });
    
    // Import here to avoid circular dependency issues if any
    const { scanForUser } = require('../workers/signalScanner.worker');
    
    // Run asynchronously without blocking the response
    scanForUser(body.userId, true).catch((e: any) => console.error('Manual scan error:', e));
    
    return reply.code(200).send({ success: true, message: 'Scan triggered in background' });
  });
};
