import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';
import { uploadsDir, initStorage } from '../utils/storage.js';
import { config } from '../config/env.js';

initStorage();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  },
});

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: config.maxFileSizeMb * 1024 * 1024,
  },
});

export function handleUploadErrors(err: any, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: `File size exceeds the ${config.maxFileSizeMb} MB limit. Task rejected.`,
      });
      return;
    }
    res.status(400).json({ error: `File upload failed: ${err.message}` });
    return;
  }
  if (err) {
    res.status(400).json({ error: err.message || 'File processing failed' });
    return;
  }
  next();
}
