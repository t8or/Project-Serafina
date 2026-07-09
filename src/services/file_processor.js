/**
 * FileProcessor — routes a file to the right processor adapter and persists output.
 *
 * Live interface: process_file, getProcessorForFile, checkDoclingAvailability, PDF_PROCESSOR_TYPES.
 * Dead bulk helpers (processPDF/Image/CSV/Excel, extractPropertyData, breakPDFIntoSections, etc.)
 * were removed after grep confirmed zero external callers — process_file uses specialized processors.
 */

import fs from 'fs/promises';
import path from 'path';
import { OllamaService } from './ollama_service.js';
import { PDFProcessor } from './processors/pdf_processor.js';
import { ImageProcessor } from './processors/image_processor.js';
import { CSVProcessor } from './processors/csv_processor.js';
import { ExcelProcessor } from './processors/excel_processor.js';
import { DoclingBridge } from './processors/docling_bridge.js';

const PDF_PROCESSOR_TYPES = {
  DEFAULT: 'default',
  DOCLING: 'docling',
  DOCLING_FULL: 'docling_full',
};

/**
 * Thin adapter so DoclingBridge.processFull matches the .process(file, options) seam
 * used by process_file for docling_full.
 */
class DoclingFullAdapter {
  constructor(bridge, defaultOutputDir) {
    this.bridge = bridge;
    this.defaultOutputDir = defaultOutputDir;
  }

  async process(filePath, options = {}) {
    const outputDir = options.outputDir || this.defaultOutputDir;
    const result = await this.bridge.processFull(filePath, outputDir);
    if (!result.processing_status) {
      result.processing_status = 'success';
    }
    return result;
  }
}

/**
 * Thin adapter so DoclingBridge.process matches the .process(file) seam.
 */
class DoclingQuickAdapter {
  constructor(bridge) {
    this.bridge = bridge;
  }

  async process(filePath) {
    const result = await this.bridge.process(filePath);
    if (!result.processing_status) {
      result.processing_status = 'success';
    }
    return result;
  }
}

class FileProcessor {
  constructor(outputDir = 'processed_files', options = {}) {
    this.outputDir = outputDir;
    this.ollamaService = new OllamaService();
    this.defaultPdfProcessor = options.pdfProcessor || PDF_PROCESSOR_TYPES.DEFAULT;

    const doclingBridge = new DoclingBridge(options.doclingOptions || {});
    const fullOutputDir = path.join(process.cwd(), this.outputDir);

    this.processors = {
      pdf: new PDFProcessor(this.ollamaService),
      pdf_docling: new DoclingQuickAdapter(doclingBridge),
      pdf_docling_full: new DoclingFullAdapter(
        new DoclingBridge(options.doclingFullOptions || options.doclingOptions || {}),
        fullOutputDir
      ),
      image: new ImageProcessor(this.ollamaService),
      csv: new CSVProcessor(this.ollamaService),
      excel: new ExcelProcessor(this.ollamaService),
    };

    this._doclingBridge = doclingBridge;
    this.initializeOutputDir();
  }

  async initializeOutputDir() {
    try {
      const fullOutputPath = path.join(process.cwd(), this.outputDir);
      await fs.mkdir(fullOutputPath, { recursive: true });
      console.log('Output directory initialized:', fullOutputPath);
    } catch (error) {
      console.error('Error initializing output directory:', error);
    }
  }

  getProcessorForFile(filePath, options = {}) {
    const ext = path.extname(filePath).toLowerCase();
    const pdfProcessorType = options.pdfProcessor || this.defaultPdfProcessor;

    switch (ext) {
      case '.pdf':
        if (pdfProcessorType === PDF_PROCESSOR_TYPES.DOCLING_FULL) {
          console.log('[FileProcessor] Using Docling Full PDF processor (all pages, section detection)');
          return this.processors.pdf_docling_full;
        }
        if (pdfProcessorType === PDF_PROCESSOR_TYPES.DOCLING) {
          console.log('[FileProcessor] Using Docling PDF processor (quick, first 7 pages)');
          return this.processors.pdf_docling;
        }
        console.log('[FileProcessor] Using default PDF processor');
        return this.processors.pdf;
      case '.png':
      case '.jpg':
      case '.jpeg':
        return this.processors.image;
      case '.csv':
        return this.processors.csv;
      case '.xlsx':
      case '.xls':
        return this.processors.excel;
      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  async checkDoclingAvailability() {
    try {
      return await this._doclingBridge.checkAvailability();
    } catch (error) {
      return {
        available: false,
        error: error.message,
      };
    }
  }

  async process_file(filePath, originalFilename = null, options = {}) {
    try {
      console.log('Processing file:', filePath);
      console.log('Original filename:', originalFilename);
      console.log('Processing options:', options);

      await fs.access(filePath);
      console.log('File exists and is accessible');

      const processor = this.getProcessorForFile(filePath, options);
      const pdfProcessorType = options.pdfProcessor || this.defaultPdfProcessor;

      console.log('Selected processor:', processor.constructor.name);
      console.log('Starting file processing...');

      if (pdfProcessorType === PDF_PROCESSOR_TYPES.DOCLING_FULL) {
        const fullOutputDir = path.join(process.cwd(), this.outputDir);
        await fs.mkdir(fullOutputDir, { recursive: true });

        const result = await processor.process(filePath, { outputDir: fullOutputDir });
        console.log('Full processing result:', result);

        if (result.processing_status === 'success' || result.processing_status === 'partial_success') {
          return {
            ...result,
            metadata: {
              ...result.metadata,
              original_filename: originalFilename,
              processor_used: processor.constructor.name,
              pdf_processor_type: pdfProcessorType,
            },
            original_filename: originalFilename,
          };
        }

        return result;
      }

      const result = await processor.process(filePath);
      console.log('File processing result:', result);

      if (result.processing_status === 'success') {
        console.log('Processing successful, preparing to save results...');

        try {
          const fullOutputDir = path.join(process.cwd(), this.outputDir);
          await fs.mkdir(fullOutputDir, { recursive: true });
          console.log('Output directory ensured:', fullOutputDir);

          const baseFilename = originalFilename
            ? path.basename(originalFilename, path.extname(originalFilename))
            : path.basename(filePath, path.extname(filePath));

          const outputPath = path.join(fullOutputDir, `e_${baseFilename}.json`);
          console.log('Saving results to:', outputPath);

          const resultWithMetadata = {
            ...result,
            metadata: {
              ...result.metadata,
              original_filename: originalFilename,
              base_filename: baseFilename,
              output_filename: `e_${baseFilename}.json`,
              processor_used: processor.constructor.name,
              pdf_processor_type:
                path.extname(filePath).toLowerCase() === '.pdf' ? pdfProcessorType : undefined,
            },
          };

          await fs.writeFile(outputPath, JSON.stringify(resultWithMetadata, null, 2));
          console.log('Results successfully saved.');

          return {
            ...resultWithMetadata,
            output_path: outputPath,
            original_filename: originalFilename,
          };
        } catch (saveError) {
          console.error('Error saving results:', saveError);
          return {
            processing_status: 'error',
            error_message: `Error saving results: ${saveError.message}`,
          };
        }
      }

      console.log('Processing failed or returned an unexpected result.');
      return result;
    } catch (error) {
      console.error('Error processing file:', error);
      console.error('Error stack:', error.stack);
      return {
        processing_status: 'error',
        error_message: `Error processing file: ${error.message}`,
      };
    }
  }
}

export { FileProcessor, PDF_PROCESSOR_TYPES };
