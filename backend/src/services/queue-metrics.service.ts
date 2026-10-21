import { prisma } from '../db/prisma.js';
import { redisConnection, taskQueue } from '../queue/redis.js';
import { DESIRED_WORKERS_KEY, MAX_WORKERS, MIN_WORKERS } from '../queue/scaling.js';

export const DEFAULT_AVERAGE_EXECUTION_MS = 20_000;
let averageExecutionCache = { value: DEFAULT_AVERAGE_EXECUTION_MS, updatedAt: 0 };
let averageExecutionInFlight: Promise<number> | null = null;

export async function getAverageExecutionMs(): Promise<number> {
  if (Date.now() - averageExecutionCache.updatedAt < 30_000) return averageExecutionCache.value;
  if (averageExecutionInFlight) return averageExecutionInFlight;

  averageExecutionInFlight = (async () => {
    const recent = await prisma.task.findMany({
      where: { status: 'COMPLETED', executionTimeMs: { not: null } },
      orderBy: { completedAt: 'desc' },
      take: 20,
      select: { executionTimeMs: true },
    });
    const durations = recent.flatMap((task) => task.executionTimeMs == null ? [] : [task.executionTimeMs]);
    const value = durations.length === 0
      ? DEFAULT_AVERAGE_EXECUTION_MS
      : Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length);
    averageExecutionCache = { value, updatedAt: Date.now() };
    return value;
  })().finally(() => { averageExecutionInFlight = null; });

  return averageExecutionInFlight;
}

export async function getWorkerCount(): Promise<number> {
  const heartbeatKeys = await redisConnection.keys('workers:heartbeat:*');
  return heartbeatKeys.length;
}

export async function getQueuePositionMap(): Promise<Map<string, number>> {
  const waitingJobs = await taskQueue.getWaiting(0, -1);
  const positions = new Map(waitingJobs.flatMap((job, index) => job.id ? [[String(job.id), index + 1] as const] : []));
  const databaseQueuedTasks = await prisma.task.findMany({
    where: { status: { in: ['PENDING', 'QUEUED'] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  let fallbackPosition = positions.size;
  for (const task of databaseQueuedTasks) {
    if (!positions.has(task.id)) positions.set(task.id, ++fallbackPosition);
  }
  return positions;
}

export function estimateWaitSeconds(queuePosition: number, averageExecutionMs: number): number {
  return Math.max(0, Math.ceil(queuePosition * (averageExecutionMs / 1000)));
}

export async function getQueueSnapshot() {
  const [waiting, active, completed, failed, workers, averageExecutionMs, desiredCountRaw] = await Promise.all([
    taskQueue.getWaitingCount(),
    taskQueue.getActiveCount(),
    taskQueue.getCompletedCount(),
    taskQueue.getFailedCount(),
    getWorkerCount(),
    getAverageExecutionMs(),
    redisConnection.get(DESIRED_WORKERS_KEY),
  ]);
  const configuredWorkers = Number.parseInt(desiredCountRaw || String(MIN_WORKERS), 10);

  return {
    redis: 'connected',
    workers: {
      active: workers,
      desired: Math.max(MIN_WORKERS, Math.min(MAX_WORKERS, configuredWorkers)),
      min: MIN_WORKERS,
      max: MAX_WORKERS,
    },
    tasks: { active, waiting, completed, failed },
    averageExecutionMs,
    timestamp: new Date().toISOString(),
  };
}
