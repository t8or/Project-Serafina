/**
 * Extract HTTP adapter — validates request, delegates to ExtractionPipeline, maps response.
 */

import express from 'express';
import {
  ExtractionPipeline,
  PDF_PROCESSOR_TYPES,
} from '../services/extraction_pipeline.js';

const router = express.Router();
const pipeline = new ExtractionPipeline();
const VALID_PDF_PROCESSORS = Object.values(PDF_PROCESSOR_TYPES);

router.use((req, res, next) => {
  console.log('\n=== Extract Handler Request ===');
  next();
});

/**
 * POST /extract/:fileId
 *
 * Query/body: pdfProcessor — 'default' | 'docling' | 'docling_full'
 */
router.post('/extract/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const pdfProcessor =
      req.body?.pdfProcessor || req.query?.pdfProcessor || PDF_PROCESSOR_TYPES.DEFAULT;

    if (!VALID_PDF_PROCESSORS.includes(pdfProcessor)) {
      return res.status(400).json({
        success: false,
        error: `Invalid pdfProcessor option. Valid options: ${VALID_PDF_PROCESSORS.join(', ')}`,
      });
    }

    const result = await pipeline.run({ fileId, processor: pdfProcessor });

    if (pdfProcessor === PDF_PROCESSOR_TYPES.DOCLING_FULL) {
      return res.json({
        success: true,
        message: `Text extracted successfully. Generated ${result.sectionFiles.length} section files.`,
        sectionFiles: result.sectionFiles,
        sections: result.sections,
        processorUsed: pdfProcessor,
        externalData: result.externalData,
        property: result.property,
        result: result.processingResult,
      });
    }

    return res.json({
      success: true,
      message: 'Text extracted successfully',
      outputPath: result.outputPath,
      processorUsed: pdfProcessor,
      result: result.processingResult,
    });
  } catch (error) {
    console.error('\n=== Extraction Error ===', error.message);
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/extract/scrape/:baseName
 */
router.post('/extract/scrape/:baseName', async (req, res) => {
  try {
    const { baseName } = req.params;
    const scrapeResult = await pipeline.scrapeByBaseName(baseName);
    res.json({
      success: true,
      message: 'External data scraped and saved',
      ...scrapeResult,
    });
  } catch (error) {
    console.error('[Extract] Manual scrape error:', error);
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.message,
      address: error.address,
      errors: error.errors,
    });
  }
});

/**
 * GET /extract/docling/status
 */
router.get('/docling/status', async (req, res) => {
  try {
    const status = await pipeline.checkDoclingAvailability();
    res.json({
      success: true,
      docling: status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
