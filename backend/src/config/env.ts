import dotenv from 'dotenv';
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  serverName: process.env.SERVER_NAME || 'API_SERVER_DEFAULT',
  workerId: process.env.WORKER_ID || 'WORKER_DEFAULT',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/media_archiver?schema=public',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  storagePath: process.env.STORAGE_PATH || './storage',
  jwtSecret: process.env.JWT_SECRET || 'default_jwt_secret_change_in_production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10),
  maxConcurrentTasksPerUser: parseInt(process.env.MAX_CONCURRENT_TASKS_PER_USER || '3', 10),
  taskTimeoutSeconds: parseInt(process.env.TASK_TIMEOUT_SECONDS || '120', 10),
};
