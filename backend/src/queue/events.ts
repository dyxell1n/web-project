import { Redis } from 'ioredis';
import { config } from '../config/env.js';

// Dedicated subscriber and publisher connections for Redis Pub/Sub
export const redisPublisher = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

export const createRedisSubscriber = (): Redis => {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
  });
};

export interface TaskProgressPayload {
  taskId: string;
  status: string;
  progress: number;
  stage: string;
  workerId?: string;
  outputFileName?: string | null;
  outputFileSize?: number | null;
  errorMessage?: string | null;
  executionTimeMs?: number | null;
}

export async function publishTaskProgress(payload: TaskProgressPayload): Promise<void> {
  const channel = `task:progress:${payload.taskId}`;
  const message = JSON.stringify(payload);
  await redisPublisher.publish(channel, message);
  // Also cache latest progress in Redis for quick retrieval
  await redisPublisher.set(`task:latest:${payload.taskId}`, message, 'EX', 3600);
}

export async function setTaskCancelled(taskId: string): Promise<void> {
  await redisPublisher.set(`task:cancel:${taskId}`, '1', 'EX', 3600);
  await redisPublisher.publish(`task:cancel:${taskId}`, JSON.stringify({ taskId, status: 'CANCELLED' }));
}

export async function isTaskCancelled(taskId: string): Promise<boolean> {
  const val = await redisPublisher.get(`task:cancel:${taskId}`);
  return val === '1';
}
