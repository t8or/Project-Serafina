import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import uploadRouter from './src/api/uploadHandler.js';
import extractRouter from './src/api/extractHandler.js';
import filesRouter from './src/api/filesHandler.js';
import fillRouter from './src/api/fillHandler.js';
import externalDataRouter from './src/api/externalDataHandler.js';
import scoringRouter from './src/api/scoringHandler.js';
import propertyRouter from './src/api/propertyHandler.js';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Increase timeout limits
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Enable CORS
app.use(cors());

// Log database configuration
console.log('Database Configuration:', {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

// Create required directories
import { mkdir } from 'fs/promises';
import { join } from 'path';

const createRequiredDirs = async () => {
  console.log('Initializing upload directories...');
  const uploadDir = join(process.cwd(), 'uploads');
  const extractedDir = join(uploadDir, 'extracted');
  const filledDir = join(uploadDir, 'filled');
  const externalDir = join(uploadDir, 'external');
  const configDir = join(uploadDir, 'config');
  
  await mkdir(uploadDir, { recursive: true });
  await mkdir(extractedDir, { recursive: true });
  await mkdir(filledDir, { recursive: true });
  await mkdir(externalDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  
  console.log('Upload directory:', uploadDir);
  console.log('Extracted files directory:', extractedDir);
  console.log('Filled templates directory:', filledDir);
  console.log('External data directory:', externalDir);
  console.log('Config directory:', configDir);
};

createRequiredDirs().catch(console.error);

// Routes
app.use('/api', uploadRouter);
app.use('/api', extractRouter);
app.use('/api/files', filesRouter);
app.use('/api/fill', fillRouter);
app.use('/api/external', externalDataRouter);
app.use('/api/scoring', scoringRouter);
app.use('/api/properties', propertyRouter);

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Something went wrong!' 
  });
});

// Start server with timeout configuration
const server = app.listen(port, () => {
  console.log(`\n========================================`);
  console.log(`Server v2.1 started at ${new Date().toISOString()}`);
  console.log(`Running on port ${port}`);
  console.log(`Demographics extraction: ENABLED`);
  console.log(`========================================\n`);
});

server.timeout = 300000; // 5 minutes timeout
server.keepAliveTimeout = 301000; // Keep-alive slightly higher than timeout 