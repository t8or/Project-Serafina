import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import uploadRouter from './src/api/uploadHandler.js';
import extractRouter from './src/api/extractHandler.js';
import filesRouter from './src/api/filesHandler.js';
import fillRouter from './src/api/fillHandler.js';
import referenceDataRouter from './src/api/referenceDataHandler.js';
import scoringRouter from './src/api/scoringHandler.js';
import propertyRouter from './src/api/propertyHandler.js';
import { initDb } from './src/config/database.js';
import { UPLOADS_DIR, assertLoopbackHost } from './src/config/runtime_paths.js';
import { assertLocalRuntimeReady } from './src/services/local_runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const host = process.env.SERAFINA_HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const buildDir = path.join(__dirname, 'build');

assertLoopbackHost(host);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// The browser UI and API share one loopback origin, so CORS is intentionally absent.
app.use('/uploads', express.static(UPLOADS_DIR));

// Keep the product root explicit. Express' static index handling would otherwise
// serve the template's legacy index page before this redirect can run.
app.get(['/', '/index.html'], (_req, res) => res.redirect(302, '/dashboard.html'));
app.use(express.static(buildDir, { index: false }));

app.use('/api', uploadRouter);
app.use('/api', extractRouter);
app.use('/api/files', filesRouter);
app.use('/api/fill', fillRouter);
app.use('/api/reference-data', referenceDataRouter);
app.use('/api/scoring', scoringRouter);
app.use('/api/properties', propertyRouter);

app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, error: err.message || 'Local server error' });
});

async function start() {
  await initDb();
  await assertLocalRuntimeReady();

  const server = app.listen(port, host, () => {
    console.log(`Serafina local runtime listening at http://${host}:${port}`);
  });
  server.timeout = 900_000;
  server.keepAliveTimeout = 901_000;
}

start().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
