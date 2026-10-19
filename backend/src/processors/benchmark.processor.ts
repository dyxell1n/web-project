import fs from 'fs';
import { isTaskCancelled } from '../queue/events.js';
import { ProgressCallback } from './image.processor.js';

export interface BenchmarkOptions {
  complexity?: number; // 1 (light) to 10 (very heavy)
  iterations?: number;
}

// Yield execution so Node.js event loop can process cancellation & I/O
const yieldEventLoop = () => new Promise((resolve) => setImmediate(resolve));

export async function processBenchmark(
  taskId: string,
  outputPath: string,
  options: BenchmarkOptions,
  onProgress: ProgressCallback
): Promise<{ outputSize: number }> {
  if (await isTaskCancelled(taskId)) throw new Error('TASK_CANCELLED');

  const complexity = Math.min(10, Math.max(1, Number(options.complexity || 5)));
  // Steps count based on complexity
  const totalSteps = 10;
  // Size of computation batch per step
  const matrixSize = 80 + complexity * 25; // Matrix of size up to 330x330 (millions of floating point ops)

  await onProgress(5, `Ініціалізація математичного стрес-тесту (рівень складності: ${complexity}/10, матриця: ${matrixSize}x${matrixSize})`);

  const startTime = Date.now();
  let operationsCount = 0;

  for (let step = 1; step <= totalSteps; step++) {
    if (await isTaskCancelled(taskId)) {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      throw new Error('TASK_CANCELLED');
    }

    const currentPercent = Math.round((step / totalSteps) * 90);
    await onProgress(
      currentPercent,
      `Етап ${step}/${totalSteps}: Обчислення матричних перетворень та ітерацій розв'язання`
    );

    // Perform intensive CPU calculations (matrix multiply and relaxation)
    const A = new Float64Array(matrixSize * matrixSize);
    const B = new Float64Array(matrixSize * matrixSize);
    const C = new Float64Array(matrixSize * matrixSize);

    for (let i = 0; i < matrixSize * matrixSize; i++) {
      A[i] = Math.sin(i + step);
      B[i] = Math.cos(i * 1.5 + step);
    }

    // Multiply block
    for (let i = 0; i < matrixSize; i++) {
      for (let k = 0; k < matrixSize; k++) {
        const aik = A[i * matrixSize + k];
        for (let j = 0; j < matrixSize; j++) {
          C[i * matrixSize + j] += aik * B[k * matrixSize + j];
          operationsCount++;
        }
      }
    }

    // Yield control so cancellation signals and Redis events are immediately handled
    await yieldEventLoop();
  }

  const durationMs = Date.now() - startTime;
  await onProgress(95, 'Формування звіту обчислень та перевірка результатів');

  const report = {
    taskId,
    taskType: 'SYNTHETIC_BENCHMARK',
    status: 'COMPLETED',
    complexity,
    matrixSize: `${matrixSize}x${matrixSize}`,
    operationsPerformed: operationsCount,
    executionTimeMs: durationMs,
    opsPerSecond: Math.round((operationsCount / (durationMs || 1)) * 1000),
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  await onProgress(100, `Обчислення успішно завершено за ${durationMs} мс`);

  const stats = fs.statSync(outputPath);
  return { outputSize: stats.size };
}
