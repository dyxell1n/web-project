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
      message: `Створено тестовий файл розміром ${sizeMb} МБ`,
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
          error: `Перевищено ліміт активних задач: у вас вже є ${activeTasksCount} активних задач (максимум: ${config.maxConcurrentTasksPerUser}). Зачекайте завершення попередніх або скасуйте їх.`,
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
        res.status(400).json({ error: 'Необхідно надати файл для обробки або вибрати синтетичний тест' });
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
          error: `Розмір файлу (${Math.round(inputFileSize / 1024 / 1024)} МБ) перевищує встановлений ліміт у ${config.maxFileSizeMb} МБ`,
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
          stage: 'Поставлено в чергу обробки',
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
        message: 'Задачу успішно створено та додано до черги обробки',
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
      res.status(404).json({ error: 'Задачу не знайдено' });
      return;
    }

    if (task.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'Немає доступу до цієї задачі' });
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
      res.status(404).json({ error: 'Задачу не знайдено' });
      return;
    }

    if (task.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'Немає прав на скасування цієї задачі' });
      return;
    }

    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.status)) {
      res.status(400).json({ error: `Неможливо скасувати задачу зі статусом ${task.status}` });
      return;
    }

    await setTaskCancelled(task.id);

    const updatedTask = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'CANCELLED',
        stage: 'Скасовано користувачем',
        completedAt: new Date(),
      },
    });

    res.json({
      message: 'Задачу успішно скасовано',
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
      res.status(404).json({ error: 'Задачу не знайдено' });
      return;
    }

    if (task.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      res.status(403).json({ error: 'Немає доступу до файлу' });
      return;
    }

    if (task.status !== 'COMPLETED' || !task.outputFileName) {
      res.status(400).json({ error: 'Файл ще не готовий або задача завершилась з помилкою' });
      return;
    }

    const filePath = getOutputFilePath(task.outputFileName);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Файл результату не знайдено на сервері' });
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
