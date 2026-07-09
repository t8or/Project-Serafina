/**
 * Local PDF processor.
 *
 * Interface:
 *   process_file(filePath, originalFilename?) -> Docling full result
 *   checkDoclingAvailability() -> availability report
 *
 * There is deliberately no processor selection or parser fallback. Serafina's
 * document contract is one local PDF -> Docling-full extraction path.
 */

import fs from 'fs/promises';
import path from 'path';
import { DoclingBridge } from './processors/docling_bridge.js';

const PDF_PROCESSOR_TYPES = { DOCLING_FULL: 'docling_full' };

class FileProcessor {
  constructor(outputDir, options = {}) {
    this.outputDir = path.resolve(outputDir);
    this.docling = options.doclingBridge || new DoclingBridge(options.doclingOptions || {});
  }

  async checkDoclingAvailability() {
    return this.docling.checkAvailability();
  }

  async process_file(filePath, originalFilename = null) {
    if (path.extname(filePath).toLowerCase() !== '.pdf') {
      return {
        processing_status: 'error',
        error_message: 'Local extraction requires a PDF document',
      };
    }

    try {
      await fs.access(filePath);
      await fs.mkdir(this.outputDir, { recursive: true });
      const result = await this.docling.processFull(filePath, this.outputDir);
      if (result.processing_status === 'error') return result;

      return {
        ...result,
        metadata: {
          ...result.metadata,
          original_filename: originalFilename,
          processor_used: 'DoclingBridge',
          pdf_processor_type: PDF_PROCESSOR_TYPES.DOCLING_FULL,
        },
        original_filename: originalFilename,
      };
    } catch (error) {
      return {
        processing_status: 'error',
        error_message: `Local Docling processing failed: ${error.message}`,
      };
    }
  }
}

export { FileProcessor, PDF_PROCESSOR_TYPES };
