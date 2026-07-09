import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { db } from '../config/database.js';
import { FileUploadService } from '../services/fileUploadService.js';
import { EXTRACTED_DIR, resolveUploadPath } from '../config/runtime_paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();
const fileUploadService = new FileUploadService();

// Get all files
router.get('/', async (req, res) => {
  try {
    const userId = '000'; // Default user for now
    const files = await fileUploadService.getFilesByUser(userId);
    res.json({ files });
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch files'
    });
  }
});

// Get extracted files (must come before parameter routes)
router.get('/extracted', async (req, res) => {
  try {
    const extractedDir = EXTRACTED_DIR;
    console.log('Reading extracted files from:', extractedDir);
    
    // Get list of files in the extracted directory
    const files = await fs.readdir(extractedDir);
    console.log('Found files:', files);
    
    // Get stats and content for all files
    const extractedFiles = await Promise.all(
      files.map(async (file) => {
          const filePath = path.join(extractedDir, file);
          const stats = await fs.stat(filePath);
          let content;
          let data = {};
          
          try {
            // Try to read as JSON first
            content = await fs.readFile(filePath, 'utf-8');
            data = file.endsWith('.json') ? JSON.parse(content) : { extracted_text: content };
          } catch (error) {
            console.warn('Could not parse file as JSON:', error);
            data = { extracted_text: 'Binary content' };
          }
          
          // Get the original filename from metadata, falling back through several options
          const baseFilename = data.metadata?.base_filename || 
                             data.metadata?.original_filename?.replace(/\.[^/.]+$/, '') ||
                             file.replace(/^e_/, '').replace(/\.json$/, '');
          
          // Construct the display filename with e_ prefix and .json extension
          const displayFilename = `e_${baseFilename}.json`;
          
          // Get the file type from the original file's extension or metadata
          const fileType = data.metadata?.file_type || 
                          (data.metadata?.original_filename && path.extname(data.metadata.original_filename).slice(1)) ||
                          'json';
          
          return {
            id: file,
            original_filename: displayFilename,
            file_type: fileType,
            file_size: stats.size,
            upload_date: stats.mtime,
            storage_path: path.join('extracted', file),
            is_extracted: true
          };
        })
    );
    
    console.log('Sending extracted files:', extractedFiles);
    res.json({ files: extractedFiles });
  } catch (error) {
    console.error('Error getting extracted files:', error);
    res.status(500).json({ error: 'Failed to get extracted files' });
  }
});

// Download a file (parameter routes should come last)
router.get('/:fileId/download', async (req, res) => {
  try {
    const { fileId } = req.params;
    
    // Check if this is a file in the extracted directory
    const extractedDir = EXTRACTED_DIR;
    const extractedFilePath = path.join(extractedDir, fileId);
    
    try {
      await fs.access(extractedFilePath);
      res.download(extractedFilePath);
      return;
    } catch (error) {
      // If not in extracted directory, try regular files
      try {
        const filePath = await fileUploadService.getFilePath(fileId);
        res.download(filePath);
      } catch (error) {
        console.error('File not found:', error);
        res.status(404).json({
          success: false,
          error: 'File not found'
        });
      }
    }
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download file'
    });
  }
});

// Delete a file
router.delete('/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    
    // Check if this is a file in the extracted directory
    const extractedDir = EXTRACTED_DIR;
    const extractedFilePath = path.join(extractedDir, fileId);
    
    try {
      await fs.access(extractedFilePath);
      await fs.unlink(extractedFilePath);
      res.json({ success: true });
      return;
    } catch (error) {
      // If not in extracted directory, try regular files
      const file = await fileUploadService.getFileById(fileId);
      if (!file) {
        return res.status(404).json({
          success: false,
          error: 'File not found'
        });
      }

      const filePath = resolveUploadPath(file.storage_path);
      
      // Delete from filesystem
      try {
        await fs.access(filePath);
        await fs.unlink(filePath);
      } catch (error) {
        console.error('Error deleting file from filesystem:', error);
      }

      // Delete from database
      await db.query('DELETE FROM files WHERE id = $1', [fileId]);
      
      res.json({ success: true });
    }
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete file'
    });
  }
});

export default router;
