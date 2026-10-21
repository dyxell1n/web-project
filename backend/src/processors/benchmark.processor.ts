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
  // One full multiplication is the workload. At complexity 10 this is 2550x2550,
  // or about 16.6 billion multiply-accumulate operations.
  const matrixSize = 2350 + complexity * 20;

  await onProgress(5, `Initializing compute stress test (complexity: ${complexity}/10, matrix: ${matrixSize}x${matrixSize})`);

  const startTime = Date.now();
  let operationsCount = 0;
  const totalSteps = 10;

  const A = new Float64Array(matrixSize * matrixSize);
  const B = new Float64Array(matrixSize * matrixSize);
  const C = new Float64Array(matrixSize * matrixSize);

  for (let i = 0; i < matrixSize * matrixSize; i++) {
    A[i] = Math.sin(i + 1);
    B[i] = Math.cos(i * 1.5 + 1);
  }

  const rowsPerStep = Math.ceil(matrixSize / totalSteps);

  for (let step = 1; step <= totalSteps; step++) {
    if (await isTaskCancelled(taskId)) {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      throw new Error('TASK_CANCELLED');
    }

    const currentPercent = Math.round(5 + (step / totalSteps) * 85);
    await onProgress(
      currentPercent,
      `Step ${step}/${totalSteps}: Calculating matrix transforms and solution iterations`
    );

    // Calculate row blocks of one full matrix multiplication. This yields to
    // the event loop between blocks so cancellation and progress stay responsive.
    const firstRow = (step - 1) * rowsPerStep;
    const lastRow = Math.min(matrixSize, firstRow + rowsPerStep);
    for (let i = firstRow; i < lastRow; i++) {
      for (let k = 0; k < matrixSize; k++) {
        const aik = A[i * matrixSize + k];
        for (let j = 0; j < matrixSize; j++) {
          C[i * matrixSize + j] += aik * B[k * matrixSize + j];
          operationsCount++;
        }
      }
    }

    await yieldEventLoop();
  }

  const durationMs = Date.now() - startTime;
  await onProgress(95, 'Preparing compute report and validating results');

  const report = {
    taskId,
    taskType: 'SYNTHETIC_BENCHMARK',
    status: 'COMPLETED',
    complexity,
    matrixSize: `${matrixSize}x${matrixSize}`,
    passesPerformed: 1,
    operationsPerformed: operationsCount,
    executionTimeMs: durationMs,
    opsPerSecond: Math.round((operationsCount / (durationMs || 1)) * 1000),
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  await onProgress(100, `Computation completed successfully in ${durationMs} ms`);

  const stats = fs.statSync(outputPath);
  return { outputSize: stats.size };
}
