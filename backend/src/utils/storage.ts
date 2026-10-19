import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';

export const storageRoot = path.resolve(config.storagePath);
export const uploadsDir = path.join(storageRoot, 'uploads');
export const outputsDir = path.join(storageRoot, 'outputs');

export function initStorage(): void {
  if (!fs.existsSync(storageRoot)) {
    fs.mkdirSync(storageRoot, { recursive: true });
  }
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  if (!fs.existsSync(outputsDir)) {
    fs.mkdirSync(outputsDir, { recursive: true });
  }
}

export function getUploadFilePath(fileName: string): string {
  return path.join(uploadsDir, fileName);
}

export function getOutputFilePath(fileName: string): string {
  return path.join(outputsDir, fileName);
}
