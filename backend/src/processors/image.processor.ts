import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { isTaskCancelled } from '../queue/events.js';

export interface ImageProcessingOptions {
  targetFormat?: 'webp' | 'jpeg' | 'png' | 'avif';
  width?: number;
  height?: number;
  quality?: number;
}

export type ProgressCallback = (progress: number, stage: string) => Promise<void>;

export async function processImage(
  taskId: string,
  inputPath: string,
  outputPath: string,
  options: ImageProcessingOptions,
  onProgress: ProgressCallback
): Promise<{ outputSize: number }> {
  if (await isTaskCancelled(taskId)) {
    throw new Error('TASK_CANCELLED');
  }

  await onProgress(10, 'Зчитування та валідація метаданих зображення');
  const metadata = await sharp(inputPath).metadata();

  if (await isTaskCancelled(taskId)) throw new Error('TASK_CANCELLED');

  await onProgress(30, 'Підготовка параметрів масштабування та фільтрації');
  let pipeline = sharp(inputPath);

  if (options.width || options.height) {
    pipeline = pipeline.resize({
      width: options.width ? Number(options.width) : undefined,
      height: options.height ? Number(options.height) : undefined,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  if (await isTaskCancelled(taskId)) throw new Error('TASK_CANCELLED');

  const format = options.targetFormat || 'webp';
  const quality = options.quality ? Math.min(100, Math.max(1, Number(options.quality))) : 80;

  await onProgress(60, `Конвертація у формат ${format.toUpperCase()} (якість: ${quality}%)`);

  switch (format) {
    case 'jpeg':
      pipeline = pipeline.jpeg({ quality });
      break;
    case 'png':
      pipeline = pipeline.png({ compressionLevel: 9 });
      break;
    case 'avif':
      pipeline = pipeline.avif({ quality });
      break;
    case 'webp':
    default:
      pipeline = pipeline.webp({ quality });
      break;
  }

  if (await isTaskCancelled(taskId)) throw new Error('TASK_CANCELLED');

  await onProgress(85, 'Запис та фінальна оптимізація файлу на диск');
  await pipeline.toFile(outputPath);

  if (await isTaskCancelled(taskId)) {
    // Clean up partial file if cancelled
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    throw new Error('TASK_CANCELLED');
  }

  const stats = fs.statSync(outputPath);
  await onProgress(100, 'Конвертацію зображення успішно завершено');

  return { outputSize: stats.size };
}
