import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { uploadMiddleware, handleUploadErrors } from '../middleware/upload.middleware.js';
import { prisma } from '../db/prisma.js';
import { taskQueue } from '../queue/redis.js';
import { setTaskCancelled, createRedisSubscriber } from '../queue/events.js';
import { config } from '../config/env.js';
import { getUploadFilePath, getOutputFilePath, uploadsDir } from '../utils/storage.js';

const router = Router();

// POST /api/tasks/generate-demo - Helper to create a dummy test file of given size
router.post('/generate-demo', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const sizeMb = Math.min(config.maxFileSizeMb, Math.max(1, parseInt(req.body.sizeMb || '5', 10)));
    const fileName = `demo_test_${Date.now()}_${sizeMb}MB.txt`;
    const filePath = getUploadFilePath(fileName);

    const chunk = Buffer.from('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Line of data for compression test.\n');
    const targetBytes = sizeMb * 1024 * 1024;
    const stream = fs.createWriteStream(filePath);

    let written = 0;
    while (written < targetBytes) {
      stream.write(chunk);
      written += chunk.length;
    }
    stream.end();

    await new Promise<void>((resolve) => {
      stream.on('finish', () => resolve());
    });

    res.json({
      message: `Sample file created (${sizeMb} MB)`,
      fileName,
      fileSize: written,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/tasks - Create and enqueue a new compute task
router.post(
  '/',
  requireAuth,
  uploadMiddleware.single('file'),
  handleUploadErrors,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;

      // 1. Check user concurrent tasks limit
      const activeTasksCount = await prisma.task.count({
        where: {
          userId,
          status: { in: ['PENDING', 'QUEUED', 'PROCESSING'] },
        },
      });

      if (activeTasksCount >= config.maxConcurrentTasksPerUser) {
        // If a file was uploaded, clean it up
        if (req.file) {
          try {
            fs.unlinkSync(req.file.path);
          } catch {}
        }
        res.status(429).json({
          error: `Active task limit reached: you have ${activeTasksCount} active tasks (maximum: ${config.maxConcurrentTasksPerUser}). Wait for a task to finish or cancel one.`,
        });
        return;
      }

      const { type, options: rawOptions, demoFileName, demoFileSize } = req.body;
      const parsedOptions = typeof rawOptions === 'string' ? JSON.parse(rawOptions) : (rawOptions || {});

      let inputFileName = '';
      let inputFileSize = 0;
      let inputFormat = '';

      if (req.file) {
        inputFileName = req.file.filename;
        inputFileSize = req.file.size;
        inputFormat = path.extname(req.file.originalname).replace('.', '').toLowerCase();
      } else if (demoFileName) {
        inputFileName = demoFileName;
        inputFileSize = parseInt(demoFileSize || '0', 10);
        inputFormat = path.extname(demoFileName).replace('.', '').toLowerCase();
      } else if (type === 'SYNTHETIC_BENCHMARK') {
        inputFileName = 'synthetic_task';
        inputFileSize = 0;
        inputFormat = 'synthetic';
      } else {
        res.status(400).json({ error: 'Upload a file or choose the synthetic benchmark task.' });
        return;
      }

      // Check max file size limit
      if (inputFileSize > config.maxFileSizeMb * 1024 * 1024) {
        if (req.file) {
          try {
            fs.unlinkSync(req.file.path);
          } catch {}
        }
        res.status(400).json({
          error: `File size (${Math.round(inputFileSize / 1024 / 1024)} MB) exceeds the ${config.maxFileSizeMb} MB limit.`,
        });
        return;
      }

      // Create Task record in DB
      const task = await prisma.task.create({
        data: {
          userId,
          type,
          status: 'PENDING',
          progress: 0,
          stage: 'Queued for processing',
          inputFileName,
          inputFileSize,
          inputFormat,
          options: parsedOptions,
          handledByServer: config.serverName,
        },
      });

      // Push into BullMQ Queue
      await taskQueue.add(
        type,
        {
          taskId: task.id,
          userId,
          type,
          inputFileName,
          inputFileSize,
          options: parsedOptions,
        },
        {
          jobId: task.id,
          attempts: 1,
        }
      );

      res.status(201).json({
        message: 'Task created and added to the processing queue',
        task,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  }
);

// GET /api/tasks - List user's tasks
router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tasks = await prisma.task.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ tasks });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/tasks/:id - Get single task
router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const taskId = String(req.params.id);
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (task.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'You do not have access to this task' });
      return;
    }

    res.json({ task });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/tasks/:id/cancel - Cancel task
router.post('/:id/cancel', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const taskId = String(req.params.id);
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (task.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'You are not allowed to cancel this task' });
      return;
    }

    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.status)) {
      res.status(400).json({ error: `Cannot cancel a task with status ${task.status}` });
      return;
    }

    await setTaskCancelled(task.id);

    const updatedTask = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'CANCELLED',
        stage: 'Cancelled by user',
        completedAt: new Date(),
      },
    });

    res.json({
      message: 'Task cancelled successfully',
      task: updatedTask,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/tasks/:id/download - Download processed file
router.get('/:id/download', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const taskId = String(req.params.id);
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    if (task.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'You do not have access to this file' });
      return;
    }

    if (task.status !== 'COMPLETED' || !task.outputFileName) {
      res.status(400).json({ error: 'The file is not ready yet or the task failed' });
      return;
    }

    const filePath = getOutputFilePath(task.outputFileName);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Result file not found on the server' });
      return;
    }

    res.download(filePath, task.outputFileName);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/tasks/:id/events - Server-Sent Events (SSE) for real-time progress
router.get('/:id/events', requireAuth, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const taskId = String(req.params.id);

  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      res.status(404).end();
      return;
    }

    if (task.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      res.status(403).end();
      return;
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
    res.flushHeaders();

    // Send initial state immediately
    res.write(
      `data: ${JSON.stringify({
        taskId: task.id,
        status: task.status,
        progress: task.progress,
        stage: task.stage,
        workerId: task.workerId,
        outputFileName: task.outputFileName,
        errorMessage: task.errorMessage,
        executionTimeMs: task.executionTimeMs,
      })}\n\n`
    );

    // If task is already in terminal state, finish stream
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.status)) {
      res.end();
      return;
    }

    const subscriber = createRedisSubscriber();
    const channel = `task:progress:${taskId}`;

    await subscriber.subscribe(channel);

    subscriber.on('message', (_ch, message) => {
      res.write(`data: ${message}\n\n`);
      try {
        const parsed = JSON.parse(message);
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(parsed.status)) {
          subscriber.unsubscribe();
          subscriber.quit();
          res.end();
        }
      } catch {}
    });

    // Keepalive ping every 15 seconds
    const pingInterval = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(pingInterval);
      subscriber.unsubscribe().catch(() => {});
      subscriber.quit().catch(() => {});
    });
  } catch (error) {
    res.status(500).end();
  }
});

export default router;
