import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import * as tar from 'tar';
import { isTaskCancelled } from '../queue/events.js';
import { ProgressCallback } from './image.processor.js';

export interface ArchiveProcessingOptions {
  format?: 'zip' | 'tar.gz';
  compressionLevel?: number; // 1 to 9
}

export async function processArchive(
  taskId: string,
  inputPath: string,
  outputPath: string,
  inputFileName: string,
  options: ArchiveProcessingOptions,
  onProgress: ProgressCallback
): Promise<{ outputSize: number }> {
  if (await isTaskCancelled(taskId)) throw new Error('TASK_CANCELLED');

  const format = options.format || 'zip';
  const compressionLevel = options.compressionLevel ? Number(options.compressionLevel) : 9;

  await onProgress(15, `Ініціалізація компресора (${format.toUpperCase()}, рівень ${compressionLevel})`);

  if (!fs.existsSync(inputPath)) {
    throw new Error('Вхідний файл не знайдено');
  }

  const inputStats = fs.statSync(inputPath);
  const totalInputBytes = inputStats.size;

  if (await isTaskCancelled(taskId)) throw new Error('TASK_CANCELLED');

  await onProgress(35, 'Зчитування потоку даних та початок компресії');

  if (format === 'tar.gz') {
    // Compress via tar
    if (await isTaskCancelled(taskId)) throw new Error('TASK_CANCELLED');
    
    await onProgress(60, 'Виконання важкого GZIP-стиснення блоків');
    await tar.create(
      {
        gzip: { level: compressionLevel },
        file: outputPath,
        cwd: path.dirname(inputPath),
      },
      [path.basename(inputPath)]
    );

    if (await isTaskCancelled(taskId)) {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      throw new Error('TASK_CANCELLED');
    }

    await onProgress(90, 'Фіналізація архіву та перевірка цілісності');
    const outStats = fs.statSync(outputPath);
    await onProgress(100, 'Архівування успішно завершено');
    return { outputSize: outStats.size };
  } else {
    // Default: ZIP archive with archiver
    return new Promise<{ outputSize: number }>((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', {
        zlib: { level: compressionLevel },
      });

      let checkInterval: NodeJS.Timeout | null = null;

      output.on('close', async () => {
        if (checkInterval) clearInterval(checkInterval);
        try {
          if (await isTaskCancelled(taskId)) {
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            reject(new Error('TASK_CANCELLED'));
            return;
          }
          await onProgress(100, 'ZIP-архів успішно створено');
          const outStats = fs.statSync(outputPath);
          resolve({ outputSize: outStats.size });
        } catch (err) {
          reject(err);
        }
      });

      archive.on('error', (err) => {
        if (checkInterval) clearInterval(checkInterval);
        reject(err);
      });

      archive.on('progress', async (data) => {
        if (totalInputBytes > 0) {
          const ratio = Math.min(0.95, data.fs.processedBytes / totalInputBytes);
          const percent = Math.floor(35 + ratio * 55);
          await onProgress(percent, `Стиснення даних: ${Math.round(data.fs.processedBytes / 1024)} KB оброблено`);
        }
      });

      // Periodic cancel check
      checkInterval = setInterval(async () => {
        if (await isTaskCancelled(taskId)) {
          archive.abort();
          if (checkInterval) clearInterval(checkInterval);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          reject(new Error('TASK_CANCELLED'));
        }
      }, 500);

      archive.pipe(output);
      archive.file(inputPath, { name: inputFileName });
      archive.finalize();
    });
  }
}
