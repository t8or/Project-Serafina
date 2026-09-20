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
      files.filter(file => !file.startsWith('.') && file.endsWith('.json')).map(async (file) => {
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
    if (path.basename(fileId) !== fileId) return res.status(400).json({error: 'Invalid file identifier'});
    
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

// Referenced evidence is deleted through its Property lifecycle, never as a loose file.
router.delete('/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    if (path.basename(fileId) !== fileId) return res.status(400).json({error: 'Invalid file identifier'});
    const extractedPath = path.join('extracted', fileId);
    const retained = (await db.query(`SELECT id FROM extracted_files WHERE storage_path = $1
      UNION ALL SELECT id FROM report_revisions WHERE evidence_path = $1`, [extractedPath])).rows;
    if (retained.length) return res.status(409).json({error: 'This file belongs to retained report evidence. Manage it through the property.'});
    const loosePath = path.join(EXTRACTED_DIR, fileId);
    const loose = await fs.stat(loosePath).catch(error => {if(error.code !== 'ENOENT') throw error; return null;});
    if (loose?.isFile()) { await fs.unlink(loosePath); return res.json({success: true}); }
    const file = await fileUploadService.getFileById(fileId);
    if (!file) return res.status(404).json({error: 'File not found'});
    db.transaction(client => {
      const references = client.query(`SELECT id FROM report_revisions WHERE file_id = $1
        UNION ALL SELECT id FROM documents WHERE storage_path = $2
        UNION ALL SELECT id FROM extraction_jobs WHERE file_id = $1 AND status IN ('queued','running')`, [file.id, file.storage_path]).rows;
      if (references.length) throw Object.assign(new Error('This source is used by a report or active job. Manage it through the property.'), {statusCode: 409});
      client.query('DELETE FROM extraction_jobs WHERE file_id = $1', [file.id]);
      client.query('DELETE FROM files WHERE id = $1', [file.id]);
    });
    await fs.unlink(resolveUploadPath(file.storage_path)).catch(error => {if(error.code !== 'ENOENT') throw error;});
    res.json({success: true});
  } catch (error) {
    res.status(error.statusCode || 500).json({success: false, error: error.message});
  }
});

export default router;
