/**
 * Extract HTTP adapter — validates the request and delegates to the single
 * local Docling-full pipeline. There is intentionally no processor selector.
 */

import express from 'express';
import { extractionJobs } from '../services/extraction_jobs.js';
import { ExtractionPipeline } from '../services/extraction_pipeline.js';

const router = express.Router();
const pipeline = new ExtractionPipeline();

router.post('/extract/:fileId', async (req, res) => {
  try {
    const job = await extractionJobs.start(req.params.fileId);
    res.status(202).json({ success: true, jobId: job.id, status: job.status,
      statusUrl: `/api/extract/jobs/${job.id}`, message: 'Report queued for complete extraction.' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/extract/jobs/:jobId', async (req, res) => {
  const job = await extractionJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
  res.json({success: true, job});
});

router.get('/extract/docling/status', async (_req, res) => {
  try {
    res.json({ success: true, docling: await pipeline.checkDoclingAvailability() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
