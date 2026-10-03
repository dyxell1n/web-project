import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { config } from '../config/env.js';

export const redisConnection = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

export const TASK_QUEUE_NAME = 'media-tasks';

export const taskQueue = new Queue(TASK_QUEUE_NAME, {
  connection: redisConnection,
});
