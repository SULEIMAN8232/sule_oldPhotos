import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// In-memory or fallback indicator for sharp
let sharp: any = null;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('[Aether Backend] sharp image optimization library could not be loaded. Falling back to original image storage.');
}

const uploadsDir = path.join(__dirname, '../../uploads');

// Multer Disk Storage Configuration for temp uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `temp-${uuidv4()}${ext}`);
  },
});

// File filter to ensure only images are uploaded
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const filetypes = /jpeg|jpg|png|webp|heic/;
  const mimetype = filetypes.test(file.mimetype);
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error('Only image files (jpg, jpeg, png, webp, heic) are allowed!'));
};

export const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
  fileFilter,
});

export interface ProcessedPhoto {
  url: string;
  thumbnailUrl: string;
}

// Post-processing function to optimize images and generate thumbnails
export async function processImage(tempFilename: string): Promise<ProcessedPhoto> {
  const tempPath = path.join(uploadsDir, tempFilename);
  const fileId = uuidv4();
  
  const optimizedFilename = `opt-${fileId}.jpg`;
  const thumbnailFilename = `thumb-${fileId}.jpg`;
  
  const optimizedPath = path.join(uploadsDir, optimizedFilename);
  const thumbnailPath = path.join(uploadsDir, thumbnailFilename);

  try {
    if (sharp) {
      // 1. Optimize main photo (high-res but compressed)
      await sharp(tempPath)
        .jpeg({ quality: 80, progressive: true })
        .toFile(optimizedPath);

      // 2. Generate small square thumbnail for grid views
      await sharp(tempPath)
        .resize(300, 300, { fit: 'cover' })
        .jpeg({ quality: 75 })
        .toFile(thumbnailPath);

      // Clean up temp file
      fs.unlinkSync(tempPath);

      return {
        url: `/uploads/${optimizedFilename}`,
        thumbnailUrl: `/uploads/${thumbnailFilename}`,
      };
    } else {
      // Fallback: Copy temp file to both optimized and thumbnail filenames
      fs.copyFileSync(tempPath, optimizedPath);
      fs.copyFileSync(tempPath, thumbnailPath);
      fs.unlinkSync(tempPath);

      return {
        url: `/uploads/${optimizedFilename}`,
        thumbnailUrl: `/uploads/${thumbnailFilename}`,
      };
    }
  } catch (error) {
    console.error('Error processing image:', error);
    // If anything fails, return the temp file as-is
    const finalFilename = `raw-${fileId}${path.extname(tempFilename)}`;
    const finalPath = path.join(uploadsDir, finalFilename);
    fs.renameSync(tempPath, finalPath);
    return {
      url: `/uploads/${finalFilename}`,
      thumbnailUrl: `/uploads/${finalFilename}`,
    };
  }
}
