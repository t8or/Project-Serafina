import { db } from '../config/database.js';
import path from 'path';
import fs from 'fs/promises';
import { UPLOADS_DIR, resolveUploadPath } from '../config/runtime_paths.js';

const UPLOAD_DIR = UPLOADS_DIR;

// Define file type directories
const FILE_TYPE_DIRS = {
  'application/pdf': 'documents',
};

export class FileUploadService {
  constructor() {
    // Ensure uploads directory exists
    this.initializeUploadDirs();
  }

  async initializeUploadDirs() {
    try {
      console.log('Initializing upload directories...');
      console.log('Upload directory:', UPLOAD_DIR);
      
      // Create main uploads directory
      try {
        await fs.access(UPLOAD_DIR);
        console.log('Main upload directory exists');
      } catch {
        console.log('Creating main upload directory');
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
      }

      // Create subdirectories for each file type
      for (const dir of new Set(Object.values(FILE_TYPE_DIRS))) {
        const fullPath = path.join(UPLOAD_DIR, dir);
        try {
          await fs.access(fullPath);
          console.log(`Subdirectory exists: ${dir}`);
        } catch {
          console.log(`Creating subdirectory: ${dir}`);
          await fs.mkdir(fullPath, { recursive: true });
        }
      }
      
      console.log('Upload directories initialized successfully');
    } catch (error) {
      console.error('Error initializing upload directories:', error);
      throw new Error('Failed to initialize upload directories');
    }
  }

  async uploadFile(file, userId = '000') {
    try {
      console.log('Starting file upload process:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      });

      // Get the appropriate subdirectory for this file type
      const fileTypeDir = FILE_TYPE_DIRS[file.mimetype] || 'other';
      console.log('File type directory:', fileTypeDir);
      
      // Generate unique filename
      const timestamp = Date.now();
      const extension = path.extname(file.originalname);
      const filename = `${timestamp}-${Math.random().toString(36).substring(7)}${extension}`;
      console.log('Generated filename:', filename);
      
      // Create full file path including subdirectory
      const relativePath = path.join(fileTypeDir, filename);
      const fullPath = path.join(UPLOAD_DIR, relativePath);
      console.log('File paths:', { relativePath, fullPath });
      
      // Save file to local filesystem
      try {
        await fs.writeFile(fullPath, file.buffer);
        console.log('File saved to filesystem');
      } catch (fsError) {
        console.error('Error saving file to filesystem:', fsError);
        throw new Error('Failed to save file to filesystem');
      }

      // Store file metadata in database
      try {
        console.log('Storing file metadata in database with values:', {
          filename,
          original_filename: file.originalname,
          file_type: file.mimetype,
          file_type_length: file.mimetype.length,
          file_size: file.size,
          userId,
          relativePath
        });

        const fileRecord = await db.query(
          `INSERT INTO files (
            filename,
            original_filename,
            file_type,
            file_size,
            user_id,
            storage_path
          ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [
            filename,
            file.originalname,
            file.mimetype,
            file.size,
            userId,
            relativePath // Store relative path for better portability
          ]
        );
        console.log('File metadata stored successfully:', fileRecord.rows[0]);
        return fileRecord.rows[0];
      } catch (dbError) {
        console.error('Database error:', dbError);
        // Try to clean up the file if database insert fails
        try {
          await fs.unlink(fullPath);
          console.log('Cleaned up file after database error');
        } catch (cleanupError) {
          console.error('Failed to clean up file after database error:', cleanupError);
        }
        throw new Error('Failed to store file metadata in database');
      }
    } catch (error) {
      console.error('File upload error:', error);
      throw error;
    }
  }

  async getFilesByUser(userId) {
    try {
      console.log('Fetching files for user:', userId);
      const result = await db.query(
        'SELECT * FROM files WHERE user_id = $1 ORDER BY upload_date DESC',
        [userId]
      );
      console.log(`Found ${result.rows.length} files`);
      return result.rows;
    } catch (error) {
      console.error('Error fetching user files:', error);
      throw new Error('Failed to fetch user files');
    }
  }

  async getFileById(fileId) {
    try {
      console.log('Fetching file by ID:', fileId);
      const result = await db.query(
        'SELECT * FROM files WHERE id = $1',
        [fileId]
      );
      if (result.rows[0]) {
        console.log('File found:', result.rows[0]);
      } else {
        console.log('File not found');
      }
      return result.rows[0];
    } catch (error) {
      console.error('Error fetching file by ID:', error);
      throw new Error('Failed to fetch file');
    }
  }

  async getFilePath(fileId) {
    try {
      console.log('Getting file path for ID:', fileId);
      const file = await this.getFileById(fileId);
      if (!file) {
        throw new Error('File not found');
      }
      const fullPath = resolveUploadPath(file.storage_path);
      console.log('Full file path:', fullPath);
      return fullPath;
    } catch (error) {
      console.error('Error getting file path:', error);
      throw error;
    }
  }
}
