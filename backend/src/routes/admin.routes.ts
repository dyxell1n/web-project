import { Router, Response } from 'express';
import { AuthenticatedRequest, requireAdmin, requireAuth } from '../middleware/auth.middleware.js';
import { getQueueSnapshot } from '../services/queue-metrics.service.js';
import { redisConnection } from '../queue/redis.js';

const router = Router();

router.get('/metrics', requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const metrics = await getQueueSnapshot();
    res.json(metrics);
  } catch (error) {
    res.status(503).json({
      error: 'Could not load queue metrics',
      redis: redisConnection.status === 'ready' ? 'connected' : 'disconnected',
      details: (error as Error).message,
    });
  }
});

export default router;
