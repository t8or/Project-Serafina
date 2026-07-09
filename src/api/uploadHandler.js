import express from 'express';
import multer from 'multer';
import { FileUploadService } from '../services/fileUploadService.js';
import path from 'path';

const router = express.Router();

// Define supported MIME types
const SUPPORTED_MIME_TYPES = {
  'application/pdf': '.pdf',
};

const fileFilter = (req, file, cb) => {
  console.log('Filtering file:', {
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size
  });

  if (SUPPORTED_MIME_TYPES[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}. Local extraction accepts PDF documents only.`), false);
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    fieldSize: 50 * 1024 * 1024 // Also increase field size limit
  },
  fileFilter: fileFilter
});

const fileUploadService = new FileUploadService();

router.post('/upload', (req, res) => {
  console.log('Upload request received');
  
  upload.array('files')(req, res, async (err) => {
    if (err) {
      console.error('Multer error:', err);
      if (err instanceof multer.MulterError) {
        return res.status(400).json({
          success: false,
          error: `Upload error: ${err.message}`
        });
      }
      return res.status(400).json({
        success: false,
        error: err.message
      });
    }

    try {
      if (!req.files) {
        console.error('No files in request');
        return res.status(400).json({
          success: false,
          error: 'No files were uploaded'
        });
      }

      console.log('Files received:', req.files.map(f => ({
        originalname: f.originalname,
        size: f.size,
        mimetype: f.mimetype
      })));

      if (req.files.length === 0) {
        console.error('Empty files array');
        return res.status(400).json({
          success: false,
          error: 'No files were uploaded'
        });
      }

      const uploadedFiles = [];
      
      for (const file of req.files) {
        console.log('Processing file:', file.originalname);
        try {
          const fileRecord = await fileUploadService.uploadFile(file);
          console.log('File processed successfully:', fileRecord);
          uploadedFiles.push(fileRecord);
        } catch (fileError) {
          console.error(`Error processing file ${file.originalname}:`, fileError);
          return res.status(500).json({
            success: false,
            error: `Failed to process file ${file.originalname}: ${fileError.message}`
          });
        }
      }

      console.log('All files processed successfully');
      res.json({
        success: true,
        files: uploadedFiles
      });
    } catch (error) {
      console.error('Upload error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
        detail: error.detail
      });
      
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to upload files'
      });
    }
  });
});

export default router;
