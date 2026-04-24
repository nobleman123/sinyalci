import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db/prisma';
import { v4 as uuidv4 } from 'uuid';

export const deviceRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/device/register
  fastify.post('/register', async (req, reply) => {
    const body = req.body as { deviceName?: string; email?: string } | undefined;
    const user = await prisma.user.create({
      data: {
        id:         uuidv4(),
        deviceName: body?.deviceName ?? 'Unknown Device',
        email:      body?.email ?? null,
      },
    });
    // Create default settings
    await prisma.userSignalSettings.create({
      data: { userId: user.id },
    });
    return reply.code(201).send({ userId: user.id, createdAt: user.createdAt });
  });
};
