/**
 * XLSX Bridge - Node.js wrapper for the Python XLSX template processors.
 * 
 * This module provides a JavaScript interface to the Python XLSX template analyzer
 * and filler, handling subprocess execution, output parsing, and error handling.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths to Python scripts
const TEMPLATE_ANALYZER_PATH = path.join(__dirname, 'xlsx_template_analyzer.py');
const TEMPLATE_FILLER_PATH = path.join(__dirname, 'xlsx_template_filler.py');

// Default paths
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const VENV_PYTHON = path.join(PROJECT_ROOT, '.venv', 'bin', 'python');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'src', 'config');
const DEFAULT_MAPPINGS_PATH = path.join(CONFIG_DIR, 'field_mappings.json');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'uploads', 'filled');

/**
 * XLSXBridge class provides a Node.js interface to the Python XLSX processors.
 * 
 * Features:
 * - Template analysis for schema extraction
 * - Template filling with JSON data
 * - Configurable Python path and timeout
 * - Error handling and logging
 */
class XLSXBridge {
  constructor(options = {}) {
    this.pythonPath = options.pythonPath || VENV_PYTHON;
    this.timeout = options.timeout || 60000; // 1 minute default
    this.mappingsPath = options.mappingsPath || DEFAULT_MAPPINGS_PATH;
  }

  /**
   * Analyze an XLSX template to extract its structure.
   * 
   * @param {string} templatePath - Path to the XLSX template
   * @param {string} outputPath - Optional path for schema output JSON
   * @returns {Promise<Object>} Template schema
   */
  async analyzeTemplate(templatePath, outputPath = null) {
    try {
      // Verify template exists
      await fs.access(templatePath);
      console.log('[XLSXBridge] Analyzing template:', templatePath);

      // Build command arguments
      const args = [TEMPLATE_ANALYZER_PATH, templatePath];
      if (outputPath) {
        args.push(outputPath);
      }

      // Execute the Python analyzer
      const output = await this._executePython(args);

      // Parse the JSON output
      try {
        const result = JSON.parse(output);
        console.log('[XLSXBridge] Analysis complete:', {
          sheets: result.sheet_count,
          inputFields: result.summary?.total_input_fields,
          formulaFields: result.summary?.total_formula_fields
        });
        return result;
      } catch (parseError) {
        console.error('[XLSXBridge] Failed to parse analyzer output:', parseError);
        return {
          error: 'Failed to parse analyzer output',
          raw_output: output.substring(0, 500)
        };
      }

    } catch (error) {
      console.error('[XLSXBridge] Analysis error:', error);
      return {
        error: error.message
      };
    }
  }

  /**
   * Fill an XLSX template with data from a JSON extract.
   * 
   * @param {string} templatePath - Path to the XLSX template
   * @param {Object|string} jsonData - JSON data object or path to JSON file
   * @param {Object} options - Optional settings
   * @param {string} options.outputPath - Output path for filled template
   * @param {string} options.mappingsPath - Path to field mappings JSON
   * @returns {Promise<Object>} Fill report with statistics
   */
  async fillTemplate(templatePath, jsonData, options = {}) {
    try {
      // Verify template exists
      await fs.access(templatePath);
      console.log('[XLSXBridge] Filling template:', templatePath);

      // Ensure output directory exists
      await fs.mkdir(OUTPUT_DIR, { recursive: true });

      // Handle JSON data - if object, write to temp file
      let jsonPath;
      let cleanupJson = false;

      if (typeof jsonData === 'string') {
        // It's a path
        jsonPath = jsonData;
        await fs.access(jsonPath);
      } else {
        // It's an object, write to temp file
        jsonPath = path.join(OUTPUT_DIR, `temp_json_${Date.now()}.json`);
        await fs.writeFile(jsonPath, JSON.stringify(jsonData, null, 2));
        cleanupJson = true;
      }

      // Use provided mappings path or default
      const mappingsPath = options.mappingsPath || this.mappingsPath;
      await fs.access(mappingsPath);

      // Generate output path if not provided
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const templateName = path.basename(templatePath, '.xlsx');
      const outputPath = options.outputPath || 
        path.join(OUTPUT_DIR, `${templateName}_filled_${timestamp}.xlsx`);

      // Build command arguments
      const args = [
        TEMPLATE_FILLER_PATH,
        templatePath,
        jsonPath,
        mappingsPath,
        outputPath
      ];

      try {
        // Execute the Python filler
        const output = await this._executePython(args);

        // Parse the JSON output
        const result = JSON.parse(output);

        console.log('[XLSXBridge] Fill complete:', {
          status: result.status,
          filled: result.summary?.total_filled,
          external: result.summary?.total_external,
          output: result.output_path
        });

        return result;

      } finally {
        // Clean up temp JSON file if we created it
        if (cleanupJson) {
          try {
            await fs.unlink(jsonPath);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      }

    } catch (error) {
      console.error('[XLSXBridge] Fill error:', error);
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Get fill report for a completed template.
   * 
   * @param {Object} fillResult - Result from fillTemplate
   * @returns {Object} Formatted fill report for UI display
   */
  formatFillReport(fillResult) {
    if (fillResult.status === 'error') {
      return {
        success: false,
        error: fillResult.error,
        message: 'Failed to fill template'
      };
    }

    const report = {
      success: true,
      outputPath: fillResult.output_path,
      timestamp: fillResult.timestamp,
      summary: {
        filled: fillResult.summary?.total_filled || 0,
        skipped: fillResult.summary?.total_skipped || 0,
        external: fillResult.summary?.total_external || 0,
        errors: fillResult.summary?.total_errors || 0
      },
      filledFields: fillResult.filled_fields || [],
      externalFields: fillResult.external_fields || [],
      errors: fillResult.errors || []
    };

    // Generate message based on results
    if (report.summary.external > 0) {
      report.message = `Filled ${report.summary.filled} fields. ${report.summary.external} fields require manual input.`;
    } else {
      report.message = `Successfully filled ${report.summary.filled} fields.`;
    }

    return report;
  }

  /**
   * Execute a Python script as a subprocess.
   * 
   * @param {string[]} args - Command line arguments
   * @returns {Promise<string>} stdout output
   */
  _executePython(args) {
    return new Promise((resolve, reject) => {
      console.log('[XLSXBridge] Executing:', this.pythonPath, args.join(' '));

      const proc = spawn(this.pythonPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: this.timeout
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        // Log stderr for debugging
        console.log('[XLSXBridge] stderr:', data.toString().trim());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Python process exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });

      // Handle timeout
      setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Python process timed out after ${this.timeout}ms`));
      }, this.timeout);
    });
  }

  /**
   * Check if the Python XLSX tools are available.
   * 
   * @returns {Promise<Object>} Status information
   */
  async checkAvailability() {
    try {
      const result = await this._executePython(['-c', 'import openpyxl; print(openpyxl.__version__)']);
      return {
        available: true,
        openpyxlVersion: result.trim()
      };
    } catch (error) {
      return {
        available: false,
        error: error.message
      };
    }
  }
}

/**
 * XLSXProcessor class - Compatible interface with existing processors.
 * 
 * This class wraps XLSXBridge to provide an interface similar to
 * other processors in the system.
 */
class XLSXProcessor {
  constructor(options = {}) {
    this.bridge = new XLSXBridge(options);
  }

  /**
   * Analyze an XLSX template (compatible with processor interface).
   * 
   * @param {string} templatePath - Path to the XLSX file
   * @returns {Promise<Object>} Template schema
   */
  async analyze(templatePath) {
    return await this.bridge.analyzeTemplate(templatePath);
  }

  /**
   * Fill an XLSX template with JSON data.
   * 
   * @param {string} templatePath - Path to the XLSX template
   * @param {Object} jsonData - Extracted JSON data
   * @param {Object} options - Fill options
   * @returns {Promise<Object>} Fill result
   */
  async fill(templatePath, jsonData, options = {}) {
    const result = await this.bridge.fillTemplate(templatePath, jsonData, options);
    return this.bridge.formatFillReport(result);
  }
}

export { XLSXBridge, XLSXProcessor };

