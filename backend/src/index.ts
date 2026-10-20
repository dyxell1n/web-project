import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/env.js';
import { prisma } from './db/prisma.js';
import { redisConnection } from './queue/redis.js';
import { initStorage } from './utils/storage.js';
import authRoutes from './routes/auth.routes.js';
import taskRoutes from './routes/task.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize shared storage folders
initStorage();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Identify which backend instance served the request (Load Balancer demo header)
app.use((_req, res, next) => {
  res.setHeader('X-Served-By', config.serverName);
  next();
});

// Serve frontend static UI
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    server: config.serverName,
    uptime: Math.round(process.uptime()),
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
    limits: {
      maxFileSizeMb: config.maxFileSizeMb,
      maxConcurrentTasksPerUser: config.maxConcurrentTasksPerUser,
      taskTimeoutSeconds: config.taskTimeoutSeconds,
    },
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);

// Fallback to index.html for root or SPA
app.get('*', (req: Request, res: Response) => {
  if (req.accepts('html')) {
    res.sendFile(path.join(publicDir, 'index.html'));
  } else {
    res.status(404).json({ error: 'Route not found' });
  }
});

app.listen(config.port, () => {
  console.log(`[${config.serverName}] API Server запущено на порту ${config.port}`);
});
