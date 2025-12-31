/**
 * Docling Bridge - Node.js wrapper for the Python Docling processor.
 * 
 * This module provides a JavaScript interface to the Python Docling PDF processor,
 * handling subprocess execution, output parsing, and error handling.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the Python Docling processors
const DOCLING_PROCESSOR_PATH = path.join(__dirname, 'docling_processor.py');
const DOCLING_FULL_PROCESSOR_PATH = path.join(__dirname, 'docling_full_processor.py');
const DOCLING_TRANSFORMER_PATH = path.join(__dirname, 'docling_transformer.py');

// Virtual environment Python path (relative to project root)
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const VENV_PYTHON = path.join(PROJECT_ROOT, '.venv', 'bin', 'python');

/**
 * DoclingBridge class provides a Node.js interface to the Python Docling processor.
 * 
 * Features:
 * - Subprocess-based execution of Python Docling processor
 * - Automatic output transformation to match existing schema
 * - Configurable page limits and timeout
 * - Error handling and logging
 */
// Default page limit for CoStar PDFs - first 7 pages contain property data
// Pages after that are comparable properties which we don't need
const DEFAULT_MAX_PAGES = 7;

class DoclingBridge {
  constructor(options = {}) {
    // Use virtual environment Python by default
    this.pythonPath = options.pythonPath || VENV_PYTHON;
    this.timeout = options.timeout || 300000; // 5 minutes default
    this.maxPages = options.maxPages !== undefined ? options.maxPages : DEFAULT_MAX_PAGES;
  }

  /**
   * Process a PDF file using Docling.
   * 
   * @param {string} filePath - Path to the PDF file
   * @param {Object} options - Processing options
   * @param {number} options.maxPages - Maximum pages to process
   * @param {boolean} options.transform - Whether to transform output to existing schema (default: true)
   * @returns {Promise<Object>} Processing result
   */
  async process(filePath, options = {}) {
    const maxPages = options.maxPages || this.maxPages;
    const shouldTransform = options.transform !== false;

    try {
      // Verify file exists
      await fs.access(filePath);
      console.log('[DoclingBridge] Processing file:', filePath);

      // Build command arguments
      const args = [DOCLING_PROCESSOR_PATH, filePath];
      if (maxPages) {
        args.push(String(maxPages));
      }

      // Execute the Python processor
      const rawResult = await this._executePython(args);

      // Parse the JSON output
      let result;
      try {
        result = JSON.parse(rawResult);
      } catch (parseError) {
        console.error('[DoclingBridge] Failed to parse Docling output:', parseError);
        return {
          processing_status: 'error',
          error_message: 'Failed to parse Docling output',
          raw_output: rawResult.substring(0, 1000) // Include partial output for debugging
        };
      }

      // Transform to existing schema if requested
      if (shouldTransform && result.processing_status !== 'error') {
        result = await this._transformOutput(result);
      }

      console.log('[DoclingBridge] Processing complete:', {
        status: result.processing_status,
        tables: result.tables?.length || result.tables_raw?.length || 0,
        pages: result.metadata?.total_pages || result.metadata?.page_count || 0
      });

      return result;

    } catch (error) {
      console.error('[DoclingBridge] Processing error:', error);
      return {
        processing_status: 'error',
        error_message: error.message
      };
    }
  }

  /**
   * Execute the Python processor as a subprocess.
   * 
   * @param {string[]} args - Command line arguments
   * @returns {Promise<string>} stdout output
   */
  _executePython(args) {
    return new Promise((resolve, reject) => {
      console.log('[DoclingBridge] Executing:', this.pythonPath, args.join(' '));

      const process = spawn(this.pythonPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: this.timeout
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
        // Log stderr in real-time for debugging
        console.log('[DoclingBridge] stderr:', data.toString().trim());
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Python process exited with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });

      // Handle timeout
      setTimeout(() => {
        process.kill('SIGTERM');
        reject(new Error(`Python process timed out after ${this.timeout}ms`));
      }, this.timeout);
    });
  }

  /**
   * Transform Docling output using the Python transformer.
   * 
   * @param {Object} doclingOutput - Raw Docling output
   * @returns {Promise<Object>} Transformed output
   */
  async _transformOutput(doclingOutput) {
    try {
      // Write output to temp file for transformer
      const tempPath = path.join(__dirname, `temp_docling_${Date.now()}.json`);
      await fs.writeFile(tempPath, JSON.stringify(doclingOutput));

      try {
        // Execute transformer
        const transformedOutput = await this._executePython([
          DOCLING_TRANSFORMER_PATH,
          tempPath
        ]);

        return JSON.parse(transformedOutput);
      } finally {
        // Clean up temp file
        try {
          await fs.unlink(tempPath);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      console.error('[DoclingBridge] Transformation error:', error);
      // Return original output if transformation fails
      return {
        ...doclingOutput,
        transformation_error: error.message
      };
    }
  }

  /**
   * Check if Docling is available and properly configured.
   * 
   * @returns {Promise<Object>} Status information
   */
  async checkAvailability() {
    try {
      const result = await this._executePython(['-c', 'import docling; print(docling.__version__)']);
      return {
        available: true,
        version: result.trim()
      };
    } catch (error) {
      return {
        available: false,
        error: error.message
      };
    }
  }

  /**
   * Process a PDF file using Docling Full Processor (all pages, section detection).
   * 
   * This method processes ALL pages of the PDF and groups content by detected
   * CoStar sections (Subject Property, Rent Comps, Construction, etc.).
   * Outputs separate JSON files per section.
   * 
   * @param {string} filePath - Path to the PDF file
   * @param {string} outputDir - Directory to write section JSON files
   * @returns {Promise<Object>} Processing result with section file paths
   */
  async processFull(filePath, outputDir) {
    try {
      // Verify file exists
      await fs.access(filePath);
      console.log('[DoclingBridge] Processing full PDF:', filePath);
      console.log('[DoclingBridge] Output directory:', outputDir);

      // Ensure output directory exists
      await fs.mkdir(outputDir, { recursive: true });

      // Build command arguments for full processor
      const args = [DOCLING_FULL_PROCESSOR_PATH, filePath, outputDir];

      // Execute the Python full processor (with longer timeout for full document)
      const fullTimeout = this.timeout * 3; // Triple timeout for full processing
      const rawResult = await this._executePythonWithTimeout(args, fullTimeout);

      // Parse the JSON output
      let result;
      try {
        result = JSON.parse(rawResult);
      } catch (parseError) {
        console.error('[DoclingBridge] Failed to parse Docling Full output:', parseError);
        return {
          processing_status: 'error',
          error_message: 'Failed to parse Docling Full output',
          raw_output: rawResult.substring(0, 1000)
        };
      }

      console.log('[DoclingBridge] Full processing complete:', {
        status: result.processing_status,
        sections: result.sections?.length || 0,
        files: result.section_files?.length || 0
      });

      return result;

    } catch (error) {
      console.error('[DoclingBridge] Full processing error:', error);
      return {
        processing_status: 'error',
        error_message: error.message
      };
    }
  }

  /**
   * Execute the Python processor with a custom timeout.
   * 
   * @param {string[]} args - Command line arguments
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<string>} stdout output
   */
  _executePythonWithTimeout(args, timeout) {
    return new Promise((resolve, reject) => {
      console.log('[DoclingBridge] Executing with timeout:', timeout, 'ms');
      console.log('[DoclingBridge] Command:', this.pythonPath, args.join(' '));

      const process = spawn(this.pythonPath, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
        // Log stderr in real-time for debugging
        console.log('[DoclingBridge] stderr:', data.toString().trim());
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Python process exited with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });

      // Handle timeout
      const timeoutId = setTimeout(() => {
        process.kill('SIGTERM');
        reject(new Error(`Python process timed out after ${timeout}ms`));
      }, timeout);

      // Clear timeout on process completion
      process.on('close', () => clearTimeout(timeoutId));
    });
  }
}

/**
 * DoclingProcessor class - Compatible interface with existing processors.
 * 
 * This class wraps DoclingBridge to provide the same interface as
 * PDFProcessor and other processors in the system.
 */
class DoclingProcessor {
  constructor(options = {}) {
    this.bridge = new DoclingBridge(options);
  }

  /**
   * Process a PDF file (compatible with BaseProcessor interface).
   * 
   * @param {string} filePath - Path to the PDF file
   * @returns {Promise<Object>} Processing result
   */
  async process(filePath) {
    const result = await this.bridge.process(filePath);
    
    // Add processing_status if not present
    if (!result.processing_status) {
      result.processing_status = 'success';
    }

    return result;
  }
}

/**
 * DoclingFullProcessor class - Full document processor with section detection.
 * 
 * This class processes ALL pages of a PDF and groups content by detected
 * CoStar sections, outputting separate JSON files per section.
 */
class DoclingFullProcessor {
  constructor(options = {}) {
    this.bridge = new DoclingBridge(options);
    // Default output directory for section files
    this.defaultOutputDir = options.outputDir || path.join(PROJECT_ROOT, 'uploads', 'extracted');
  }

  /**
   * Process a PDF file with full section detection (compatible with BaseProcessor interface).
   * 
   * @param {string} filePath - Path to the PDF file
   * @param {Object} options - Processing options
   * @param {string} options.outputDir - Override output directory for section files
   * @returns {Promise<Object>} Processing result with section file paths
   */
  async process(filePath, options = {}) {
    const outputDir = options.outputDir || this.defaultOutputDir;
    
    const result = await this.bridge.processFull(filePath, outputDir);
    
    // Add processing_status if not present
    if (!result.processing_status) {
      result.processing_status = 'success';
    }

    return result;
  }
}

export { DoclingBridge, DoclingProcessor, DoclingFullProcessor };

