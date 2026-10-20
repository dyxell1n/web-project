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

  await onProgress(15, `Initializing compressor (${format.toUpperCase()}, level ${compressionLevel})`);

  if (!fs.existsSync(inputPath)) {
    throw new Error('Input file not found');
  }

  const inputStats = fs.statSync(inputPath);
  const totalInputBytes = inputStats.size;

  if (await isTaskCancelled(taskId)) throw new Error('TASK_CANCELLED');

  await onProgress(35, 'Reading data stream and starting compression');

  if (format === 'tar.gz') {
    // Compress via tar
    if (await isTaskCancelled(taskId)) throw new Error('TASK_CANCELLED');
    
    await onProgress(60, 'Compressing data blocks with GZIP');
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

    await onProgress(90, 'Finalizing archive and checking integrity');
    const outStats = fs.statSync(outputPath);
    await onProgress(100, 'Archiving completed successfully');
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
          await onProgress(100, 'ZIP archive created successfully');
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
          await onProgress(percent, `Compressing data: ${Math.round(data.fs.processedBytes / 1024)} KB processed`);
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
