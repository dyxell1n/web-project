import { Worker, Job } from 'bullmq';
import path from 'path';
import fs from 'fs';
import { config } from './config/env.js';
import { redisConnection, TASK_QUEUE_NAME } from './queue/redis.js';
import { prisma } from './db/prisma.js';
import { publishTaskProgress, isTaskCancelled } from './queue/events.js';
import { initStorage, getUploadFilePath, getOutputFilePath } from './utils/storage.js';
import { processImage } from './processors/image.processor.js';
import { processArchive } from './processors/archive.processor.js';
import { processBenchmark } from './processors/benchmark.processor.js';

initStorage();

console.log(`[${config.workerId}] Ініціалізація пулу обчислювального воркера...`);

export interface JobData {
  taskId: string;
  userId: string;
  type: 'ARCHIVE_COMPRESS' | 'MEDIA_CONVERT' | 'SYNTHETIC_BENCHMARK';
  inputFileName: string;
  inputFileSize: number;
  options: any;
}

const createWorker = (): Worker<JobData> => {
  const workerInstance = new Worker<JobData>(
  TASK_QUEUE_NAME,
  async (job: Job<JobData>) => {
    const { taskId, type, inputFileName, options } = job.data;
    const startTime = Date.now();

    console.log(`[${config.workerId}] Взято задачу в обробку: ${taskId} (${type})`);

    // Helper to report progress to both Redis Pub/Sub and PostgreSQL
    const reportProgress = async (progress: number, stage: string) => {
      try {
        await prisma.task.update({
          where: { id: taskId },
          data: {
            progress,
            stage,
            status: progress >= 100 ? 'COMPLETED' : 'PROCESSING',
          },
        });
      } catch (e) {
        console.error(`[${config.workerId}] Помилка оновлення статусу в БД:`, e);
      }

      await publishTaskProgress({
        taskId,
        status: progress >= 100 ? 'COMPLETED' : 'PROCESSING',
        progress,
        stage,
        workerId: config.workerId,
      });
    };

    // 1. Check if cancelled before starting
    if (await isTaskCancelled(taskId)) {
      console.log(`[${config.workerId}] Задачу ${taskId} скасовано користувачем до старту.`);
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'CANCELLED',
          stage: 'Cancelled by user',
          workerId: config.workerId,
        },
      });
      await publishTaskProgress({
        taskId,
        status: 'CANCELLED',
        progress: 0,
        stage: 'Cancelled by user',
        workerId: config.workerId,
      });
      return { cancelled: true };
    }

    // 2. Mark task as PROCESSING in DB
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'PROCESSING',
        stage: 'Assigned to a worker, starting…',
        workerId: config.workerId,
        startedAt: new Date(),
        progress: 5,
      },
    });

    await publishTaskProgress({
      taskId,
      status: 'PROCESSING',
      progress: 5,
      stage: 'Assigned to a worker, starting…',
      workerId: config.workerId,
    });

    // 3. Prepare paths
    const inputPath = inputFileName ? getUploadFilePath(inputFileName) : '';
    let outputFileName = '';
    let outputPath = '';

    if (type === 'MEDIA_CONVERT') {
      const targetFormat = options?.targetFormat || 'webp';
      const baseName = path.parse(inputFileName).name;
      outputFileName = `${baseName}_converted_${Date.now()}.${targetFormat}`;
      outputPath = getOutputFilePath(outputFileName);
    } else if (type === 'ARCHIVE_COMPRESS') {
      const ext = options?.format === 'tar.gz' ? 'tar.gz' : 'zip';
      const baseName = path.parse(inputFileName).name;
      outputFileName = `${baseName}_compressed_${Date.now()}.${ext}`;
      outputPath = getOutputFilePath(outputFileName);
    } else if (type === 'SYNTHETIC_BENCHMARK') {
      outputFileName = `benchmark_report_${taskId}.json`;
      outputPath = getOutputFilePath(outputFileName);
    }

    // 4. Execution with timeout wrapper
    try {
      const timeoutMs = config.taskTimeoutSeconds * 1000;
      
      const executionPromise = (async () => {
        let resultOutputSize = 0;

        if (type === 'MEDIA_CONVERT') {
          const res = await processImage(taskId, inputPath, outputPath, options, reportProgress);
          resultOutputSize = res.outputSize;
        } else if (type === 'ARCHIVE_COMPRESS') {
          const res = await processArchive(taskId, inputPath, outputPath, inputFileName, options, reportProgress);
          resultOutputSize = res.outputSize;
        } else if (type === 'SYNTHETIC_BENCHMARK') {
          const res = await processBenchmark(taskId, outputPath, options, reportProgress);
          resultOutputSize = res.outputSize;
        }

        return { resultOutputSize };
      })();

      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('TASK_TIMEOUT'));
        }, timeoutMs);
        timer.unref();
      });

      const { resultOutputSize } = await Promise.race([executionPromise, timeoutPromise]);
      const executionTimeMs = Date.now() - startTime;

      // 5. Finalize completed task
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'COMPLETED',
          progress: 100,
          stage: 'Completed successfully',
          outputFileName,
          outputFileSize: resultOutputSize,
          outputFormat: path.extname(outputFileName).replace('.', ''),
          executionTimeMs,
          completedAt: new Date(),
        },
      });

      await publishTaskProgress({
        taskId,
        status: 'COMPLETED',
        progress: 100,
        stage: 'Completed successfully',
        workerId: config.workerId,
        outputFileName,
        outputFileSize: resultOutputSize,
        executionTimeMs,
      });

      console.log(`[${config.workerId}] Задачу ${taskId} успішно завершено за ${executionTimeMs} мс.`);
      return { success: true, taskId, executionTimeMs };
    } catch (err: any) {
      const executionTimeMs = Date.now() - startTime;
      const isCancelled = err.message === 'TASK_CANCELLED' || (await isTaskCancelled(taskId));
      const isTimeout = err.message === 'TASK_TIMEOUT';

      // Clean up incomplete output file if exists
      if (outputPath && fs.existsSync(outputPath)) {
        try {
          fs.unlinkSync(outputPath);
        } catch {}
      }

      if (isCancelled) {
        console.log(`[${config.workerId}] Задача ${taskId} перервана (скасована).`);
        await prisma.task.update({
          where: { id: taskId },
          data: {
            status: 'CANCELLED',
            stage: 'Interrupted by user',
            executionTimeMs,
            completedAt: new Date(),
          },
        });
        await publishTaskProgress({
          taskId,
          status: 'CANCELLED',
          progress: 0,
          stage: 'Interrupted by user',
          workerId: config.workerId,
        });
        return { cancelled: true, taskId };
      }

      const errorMessage = isTimeout
        ? `Maximum execution time exceeded (${config.taskTimeoutSeconds} s). The task was stopped.`
        : err.message || 'Unknown processing error';

      console.error(`[${config.workerId}] Помилка виконання задачі ${taskId}:`, errorMessage);

      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'FAILED',
          stage: 'Execution failed',
          errorMessage,
          executionTimeMs,
          completedAt: new Date(),
        },
      });

      await publishTaskProgress({
        taskId,
        status: 'FAILED',
        progress: 0,
        stage: 'Execution failed',
        workerId: config.workerId,
        errorMessage,
      });

      throw err;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // 1 heavy task per compute worker to accurately reflect load balancing
  }
  );

  workerInstance.on('ready', () => {
    console.log(`[${config.workerId}] Compute worker готовий до виконання задач.`);
  });

  workerInstance.on('failed', (job, err) => {
    console.error(`[${config.workerId}] Job ${job?.id} failed:`, err.message);
  });
  return workerInstance;
};

const workerSlot = Number.parseInt(process.env.WORKER_SLOT || '1', 10);
const desiredWorkersKey = 'workers:desired-count';
const heartbeatKey = `workers:heartbeat:${config.workerId}`;
let managedWorker: Worker<JobData> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let syncing = false;

async function syncWorkerState() {
  if (syncing) return;
  syncing = true;
  try {
    const desiredRaw = await redisConnection.get(desiredWorkersKey);
    const desiredWorkers = Math.max(2, Math.min(4, Number.parseInt(desiredRaw || '2', 10) || 2));
    const shouldRun = workerSlot <= desiredWorkers;

    if (shouldRun && !managedWorker) {
      managedWorker = createWorker();
      const refreshHeartbeat = () => redisConnection.set(heartbeatKey, String(Date.now()), 'EX', 15).catch(() => {});
      refreshHeartbeat();
      heartbeatTimer = setInterval(refreshHeartbeat, 5_000);
      heartbeatTimer.unref();
      console.log(`[${config.workerId}] Worker slot ${workerSlot} enabled (target ${desiredWorkers}).`);
    } else if (!shouldRun && managedWorker) {
      await managedWorker.close();
      managedWorker = null;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      await redisConnection.del(heartbeatKey);
      console.log(`[${config.workerId}] Worker slot ${workerSlot} paused (target ${desiredWorkers}).`);
    }
  } catch (error) {
    console.error(`[${config.workerId}] Could not sync worker scale:`, (error as Error).message);
  } finally {
    syncing = false;
  }
}

void syncWorkerState();
const scalePoll = setInterval(() => void syncWorkerState(), 2_000);
scalePoll.unref();
