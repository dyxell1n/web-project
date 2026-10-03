import express, { Request, Response } from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { prisma } from './db/prisma.js';
import { redisConnection } from './queue/redis.js';

const app = express();

app.use(cors());
app.use(express.json());

// Identify which backend instance served the request (Load Balancer demo)
app.use((_req, res, next) => {
  res.setHeader('X-Served-By', config.serverName);
  next();
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    server: config.serverName,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Status check including DB and Redis
app.get('/api/status', async (_req: Request, res: Response) => {
  let dbStatus = 'disconnected';
  let redisStatus = 'disconnected';

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = `error: ${(err as Error).message}`;
  }

  try {
    const ping = await redisConnection.ping();
    if (ping === 'PONG') redisStatus = 'connected';
  } catch (err) {
    redisStatus = `error: ${(err as Error).message}`;
  }

  res.json({
    server: config.serverName,
    environment: config.env,
    database: dbStatus,
    redis: redisStatus,
    timestamp: new Date().toISOString(),
  });
});

app.listen(config.port, () => {
  console.log(`[${config.serverName}] Server running on port ${config.port}`);
});
