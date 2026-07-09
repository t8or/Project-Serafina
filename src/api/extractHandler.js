/**
 * Extract HTTP adapter — validates the request and delegates to the single
 * local Docling-full pipeline. There is intentionally no processor selector.
 */

import express from 'express';
import { ExtractionPipeline } from '../services/extraction_pipeline.js';

const router = express.Router();
const pipeline = new ExtractionPipeline();

router.post('/extract/:fileId', async (req, res) => {
  try {
    const result = await pipeline.run({ fileId: req.params.fileId });
    res.json({
      success: true,
      message: `Document extracted locally. Generated ${result.sectionFiles.length} section files.`,
      sectionFiles: result.sectionFiles,
      sections: result.sections,
      processorUsed: result.processor,
      referenceData: result.referenceData,
      property: result.property,
      result: result.processingResult,
    });
  } catch (error) {
    console.error('[Extract] Local extraction error:', error.message);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.get('/extract/docling/status', async (_req, res) => {
  try {
    res.json({ success: true, docling: await pipeline.checkDoclingAvailability() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
