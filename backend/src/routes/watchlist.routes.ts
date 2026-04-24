import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db/prisma';

export const watchlistRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/watchlist/:userId
  fastify.get<{ Params: { userId: string } }>('/:userId', async (req, reply) => {
    const items = await prisma.watchlist.findMany({
      where:   { userId: req.params.userId },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  });

  // POST /api/watchlist/:userId
  fastify.post<{ Params: { userId: string }; Body: { symbol: string } }>(
    '/:userId', async (req, reply) => {
      const symbol = req.body.symbol?.toUpperCase();
      if (!symbol) return reply.code(400).send({ error: 'Missing symbol' });

      const count = await prisma.watchlist.count({ where: { userId: req.params.userId } });
      if (count >= 200) return reply.code(400).send({ error: 'Max 200 symbols in watchlist' });

      const item = await prisma.watchlist.upsert({
        where:  { userId_symbol: { userId: req.params.userId, symbol } },
        update: { enabled: true },
        create: { userId: req.params.userId, symbol },
      });
      return reply.code(201).send(item);
    }
  );

  // DELETE /api/watchlist/:userId/:symbol
  fastify.delete<{ Params: { userId: string; symbol: string } }>(
    '/:userId/:symbol', async (req, reply) => {
      await prisma.watchlist.deleteMany({
        where: { userId: req.params.userId, symbol: req.params.symbol.toUpperCase() },
      });
      return { ok: true };
    }
  );
};
