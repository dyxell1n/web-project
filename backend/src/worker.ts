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

export const worker = new Worker<JobData>(
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
          stage: 'Скасовано користувачем',
          workerId: config.workerId,
        },
      });
      await publishTaskProgress({
        taskId,
        status: 'CANCELLED',
        progress: 0,
        stage: 'Скасовано користувачем',
        workerId: config.workerId,
      });
      return { cancelled: true };
    }

    // 2. Mark task as PROCESSING in DB
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'PROCESSING',
        stage: 'Призначено воркеру, запуск обробки...',
        workerId: config.workerId,
        startedAt: new Date(),
        progress: 5,
      },
    });

    await publishTaskProgress({
      taskId,
      status: 'PROCESSING',
      progress: 5,
      stage: 'Призначено воркеру, запуск обробки...',
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
          stage: 'Успішно виконано',
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
        stage: 'Успішно виконано',
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
            stage: 'Перервано користувачем',
            executionTimeMs,
            completedAt: new Date(),
          },
        });
        await publishTaskProgress({
          taskId,
          status: 'CANCELLED',
          progress: 0,
          stage: 'Перервано користувачем',
          workerId: config.workerId,
        });
        return { cancelled: true, taskId };
      }

      const errorMessage = isTimeout
        ? `Перевищено максимальний час виконання (${config.taskTimeoutSeconds} с). Задачу примусово зупинено.`
        : err.message || 'Невідома помилка під час обробки';

      console.error(`[${config.workerId}] Помилка виконання задачі ${taskId}:`, errorMessage);

      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'FAILED',
          stage: 'Помилка виконання',
          errorMessage,
          executionTimeMs,
          completedAt: new Date(),
        },
      });

      await publishTaskProgress({
        taskId,
        status: 'FAILED',
        progress: 0,
        stage: 'Помилка виконання',
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

worker.on('ready', () => {
  console.log(`[${config.workerId}] Compute worker готовий до виконання задач.`);
});

worker.on('failed', (job, err) => {
  console.error(`[${config.workerId}] Job ${job?.id} failed:`, err.message);
});
