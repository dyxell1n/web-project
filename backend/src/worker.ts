import { Worker, Job } from 'bullmq';
import { config } from './config/env.js';
import { redisConnection, TASK_QUEUE_NAME } from './queue/redis.js';

console.log(`[${config.workerId}] Initializing compute worker...`);

export const worker = new Worker(
  TASK_QUEUE_NAME,
  async (job: Job) => {
    console.log(`[${config.workerId}] Processing job ${job.id} (${job.name})...`);
    // Worker task logic will be implemented in Phase 2
    return { success: true, processedBy: config.workerId };
  },
  {
    connection: redisConnection,
    concurrency: 1, // 1 heavy compute task per worker node to demonstrate real load
  }
);

worker.on('ready', () => {
  console.log(`[${config.workerId}] Worker is ready and waiting for compute jobs.`);
});

worker.on('failed', (job, err) => {
  console.error(`[${config.workerId}] Job ${job?.id} failed:`, err);
});
