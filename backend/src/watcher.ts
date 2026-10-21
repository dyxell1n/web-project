import { redisConnection, taskQueue } from './queue/redis.js';
import { DESIRED_WORKERS_KEY, MAX_WORKERS, MIN_WORKERS } from './queue/scaling.js';

const POLL_INTERVAL_MS = 5_000;
const SCALE_DOWN_DELAY_MS = 20_000;
let idleSince: number | null = null;

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function updateWorkerTarget() {
  const [waiting, active, desiredRaw] = await Promise.all([
    taskQueue.getWaitingCount(),
    taskQueue.getActiveCount(),
    redisConnection.get(DESIRED_WORKERS_KEY),
  ]);
  const current = Math.max(MIN_WORKERS, Math.min(MAX_WORKERS, Number.parseInt(desiredRaw || String(MIN_WORKERS), 10)));
  let desired = current;

  if (waiting > 0) {
    idleSince = null;
    desired = Math.min(MAX_WORKERS, MIN_WORKERS + waiting);
  } else if (active <= MIN_WORKERS && current > MIN_WORKERS) {
    idleSince ??= Date.now();
    if (Date.now() - idleSince >= SCALE_DOWN_DELAY_MS) desired = MIN_WORKERS;
  } else if (current === MIN_WORKERS) {
    idleSince = null;
  }

  if (desired !== current) {
    await redisConnection.set(DESIRED_WORKERS_KEY, String(desired));
    console.log(`[autoscaler] Queue waiting=${waiting}, active=${active}; workers ${current} -> ${desired}`);
  } else if (!desiredRaw) {
    await redisConnection.set(DESIRED_WORKERS_KEY, String(MIN_WORKERS));
  }
}

console.log(`[autoscaler] Watching queue; worker range ${MIN_WORKERS}-${MAX_WORKERS}.`);

while (true) {
  try {
    await updateWorkerTarget();
  } catch (error) {
    console.error('[autoscaler] Could not read queue or update worker target:', (error as Error).message);
  }
  await sleep(POLL_INTERVAL_MS);
}
