/**
 * Fill Handler - API endpoints for XLSX template filling and analysis.
 * 
 * This handler provides endpoints to:
 * - Analyze XLSX templates to extract their structure
 * - Fill XLSX templates with data from JSON extracts
 * - List available templates and their schemas
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { db } from '../config/database.js';
import fs from 'fs/promises';
import { XLSXBridge, XLSXProcessor } from '../services/processors/xlsx_bridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Initialize XLSX processor
const xlsxProcessor = new XLSXProcessor();

// Paths
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, '..'); // Root directory for templates
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');
const UPLOADS_DIR = path.join(PROJECT_ROOT, '..', 'uploads');
const FILLED_DIR = path.join(UPLOADS_DIR, 'filled');
const EXTRACTED_DIR = path.join(UPLOADS_DIR, 'extracted');

/**
 * Analyze an XLSX template to extract its structure.
 * 
 * POST /fill/analyze
 * 
 * Body Parameters:
 * - templatePath: Path to the XLSX template (relative to project root or absolute)
 * - outputPath: (optional) Path to save the schema JSON
 */
router.post('/analyze', async (req, res) => {
  try {
    const { templatePath, outputPath } = req.body;
    
    if (!templatePath) {
      return res.status(400).json({
        success: false,
        error: 'templatePath is required'
      });
    }
    
    console.log('[FillHandler] Analyzing template:', templatePath);
    
    // Resolve template path
    const resolvedPath = path.isAbsolute(templatePath) 
      ? templatePath 
      : path.resolve(TEMPLATES_DIR, templatePath);
    
    // Check if template exists
    try {
      await fs.access(resolvedPath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: `Template not found: ${templatePath}`
      });
    }
    
    // Analyze the template
    const schema = await xlsxProcessor.analyze(resolvedPath);
    
    // Save schema if output path provided
    if (outputPath) {
      const resolvedOutputPath = path.isAbsolute(outputPath)
        ? outputPath
        : path.resolve(CONFIG_DIR, outputPath);
      
      await fs.writeFile(resolvedOutputPath, JSON.stringify(schema, null, 2));
      console.log('[FillHandler] Schema saved to:', resolvedOutputPath);
    }
    
    res.json({
      success: true,
      message: 'Template analyzed successfully',
      schema: {
        template_name: schema.template_name,
        sheet_count: schema.sheet_count,
        summary: schema.summary
      },
      outputPath: outputPath || null
    });
    
  } catch (error) {
    console.error('[FillHandler] Analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Fill an XLSX template with data from a JSON extract.
 * 
 * POST /fill/template
 * 
 * Body Parameters:
 * - templatePath: Path to the XLSX template
 * - jsonPath: Path to the JSON extract file OR
 * - jsonData: JSON data object directly
 * - fileId: (optional) Database file ID to get JSON extract from
 * - outputPath: (optional) Custom output path for filled template
 */
router.post('/template', async (req, res) => {
  try {
    const { templatePath, jsonPath, jsonData, fileId, outputPath } = req.body;
    
    if (!templatePath) {
      return res.status(400).json({
        success: false,
        error: 'templatePath is required'
      });
    }
    
    if (!jsonPath && !jsonData && !fileId) {
      return res.status(400).json({
        success: false,
        error: 'Either jsonPath, jsonData, or fileId is required'
      });
    }
    
    console.log('[FillHandler] Filling template:', templatePath);
    
    // Resolve template path
    const resolvedTemplatePath = path.isAbsolute(templatePath)
      ? templatePath
      : path.resolve(TEMPLATES_DIR, templatePath);
    
    // Check if template exists
    try {
      await fs.access(resolvedTemplatePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: `Template not found: ${templatePath}`
      });
    }
    
    // Get JSON data
    let dataToUse;
    
    if (jsonData) {
      // Direct JSON data provided
      dataToUse = jsonData;
    } else if (jsonPath) {
      // JSON file path provided
      const resolvedJsonPath = path.isAbsolute(jsonPath)
        ? jsonPath
        : path.resolve(EXTRACTED_DIR, jsonPath);
      
      try {
        const jsonContent = await fs.readFile(resolvedJsonPath, 'utf-8');
        dataToUse = JSON.parse(jsonContent);
      } catch (error) {
        return res.status(404).json({
          success: false,
          error: `JSON file not found or invalid: ${jsonPath}`
        });
      }
    } else if (fileId) {
      // Get JSON from database file reference
      const fileQuery = await db.query(
        'SELECT original_filename FROM files WHERE id = $1',
        [fileId]
      );
      
      if (fileQuery.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: `File not found in database: ${fileId}`
        });
      }
      
      const { original_filename } = fileQuery.rows[0];
      const extractedFileName = `e_${path.basename(original_filename, path.extname(original_filename))}.json`;
      const extractedPath = path.join(EXTRACTED_DIR, extractedFileName);
      
      try {
        const jsonContent = await fs.readFile(extractedPath, 'utf-8');
        dataToUse = JSON.parse(jsonContent);
      } catch (error) {
        return res.status(404).json({
          success: false,
          error: `Extracted JSON not found for file: ${original_filename}. Run extraction first.`
        });
      }
    }
    
    // Ensure filled directory exists
    await fs.mkdir(FILLED_DIR, { recursive: true });
    
    // Fill the template
    const result = await xlsxProcessor.fill(resolvedTemplatePath, dataToUse, {
      outputPath: outputPath ? path.resolve(FILLED_DIR, outputPath) : undefined
    });
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to fill template'
      });
    }
    
    // Get relative output path for response
    const relativeOutputPath = path.relative(UPLOADS_DIR, result.outputPath);
    
    res.json({
      success: true,
      message: result.message,
      outputPath: relativeOutputPath,
      absolutePath: result.outputPath,
      summary: result.summary,
      externalFields: result.externalFields,
      filledFields: result.filledFields?.length || 0
    });
    
  } catch (error) {
    console.error('[FillHandler] Fill error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * List available templates.
 * 
 * GET /fill/templates
 */
router.get('/templates', async (req, res) => {
  try {
    // Look for XLSX files in project root
    const files = await fs.readdir(TEMPLATES_DIR);
    const templates = files.filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
    
    const templateInfo = await Promise.all(templates.map(async (name) => {
      const filePath = path.join(TEMPLATES_DIR, name);
      const stats = await fs.stat(filePath);
      
      // Check if schema exists
      const schemaPath = path.join(CONFIG_DIR, `${path.basename(name, '.xlsx')}_template_schema.json`);
      let hasSchema = false;
      try {
        await fs.access(schemaPath);
        hasSchema = true;
      } catch (e) {
        // No schema
      }
      
      return {
        name,
        size: stats.size,
        modified: stats.mtime,
        hasSchema
      };
    }));
    
    res.json({
      success: true,
      templates: templateInfo
    });
    
  } catch (error) {
    console.error('[FillHandler] List templates error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get the field mappings configuration.
 * 
 * GET /fill/mappings
 */
router.get('/mappings', async (req, res) => {
  try {
    const mappingsPath = path.join(CONFIG_DIR, 'field_mappings.json');
    
    try {
      const content = await fs.readFile(mappingsPath, 'utf-8');
      const mappings = JSON.parse(content);
      
      res.json({
        success: true,
        mappings
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        error: 'Field mappings not found. Run template analysis first.'
      });
    }
    
  } catch (error) {
    console.error('[FillHandler] Get mappings error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * List filled templates.
 * 
 * GET /fill/filled
 */
router.get('/filled', async (req, res) => {
  try {
    // Ensure directory exists
    await fs.mkdir(FILLED_DIR, { recursive: true });
    
    const files = await fs.readdir(FILLED_DIR);
    const filledTemplates = files.filter(f => f.endsWith('.xlsx'));
    
    const templateInfo = await Promise.all(filledTemplates.map(async (name) => {
      const filePath = path.join(FILLED_DIR, name);
      const stats = await fs.stat(filePath);
      
      return {
        name,
        size: stats.size,
        created: stats.birthtime,
        downloadPath: `/uploads/filled/${name}`
      };
    }));
    
    // Sort by creation date, newest first
    templateInfo.sort((a, b) => new Date(b.created) - new Date(a.created));
    
    res.json({
      success: true,
      files: templateInfo
    });
    
  } catch (error) {
    console.error('[FillHandler] List filled error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Check XLSX processor availability.
 * 
 * GET /fill/status
 */
router.get('/status', async (req, res) => {
  try {
    const bridge = new XLSXBridge();
    const status = await bridge.checkAvailability();
    
    res.json({
      success: true,
      xlsxProcessor: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;

