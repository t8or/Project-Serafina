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
import { XLSXBridge } from '../services/processors/xlsx_bridge.js';
import { PropertyService } from '../services/property_service.js';
import {
  assembleFillPayload,
  assembleFillPayloadFromBaseName,
} from '../services/property_extract_adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Deep XLSXBridge — no shallow XLSXProcessor pass-through
const xlsxBridge = new XLSXBridge();
const propertyService = new PropertyService();

// Paths
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, '..'); // Root directory for templates
const CONFIG_DIR = path.join(PROJECT_ROOT, 'src', 'config');
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
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
    const schema = await xlsxBridge.analyzeTemplate(resolvedPath);
    
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
 * - jsonPath | jsonData | fileId | baseName | propertyId: data source
 * - propertyId: (optional) when set, links filled XLSX via PropertyService.linkGeneratedFile
 * - baseName: (optional) docling_full extraction prefix (e.g. e_123-abc) → PropertyExtract adapter
 * - outputPath: (optional) Custom output path for filled template
 */
router.post('/template', async (req, res) => {
  try {
    const {
      templatePath,
      jsonPath,
      jsonData,
      fileId,
      baseName,
      propertyId,
      outputPath,
    } = req.body;

    if (!templatePath) {
      return res.status(400).json({
        success: false,
        error: 'templatePath is required',
      });
    }

    if (!jsonPath && !jsonData && !fileId && !baseName && !propertyId) {
      return res.status(400).json({
        success: false,
        error: 'Either jsonPath, jsonData, fileId, baseName, or propertyId is required',
      });
    }

    console.log('[FillHandler] Filling template:', templatePath);

    const resolvedTemplatePath = path.isAbsolute(templatePath)
      ? templatePath
      : path.resolve(TEMPLATES_DIR, templatePath);

    try {
      await fs.access(resolvedTemplatePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: `Template not found: ${templatePath}`,
      });
    }

    let dataToUse;
    let dataSource = 'unknown';
    let resolvedPropertyId = propertyId ? parseInt(propertyId, 10) : null;
    if (resolvedPropertyId && isNaN(resolvedPropertyId)) {
      resolvedPropertyId = null;
    }

    if (jsonData) {
      dataToUse = jsonData;
      dataSource = 'jsonData';
    } else if (baseName) {
      dataToUse = await assembleFillPayloadFromBaseName(EXTRACTED_DIR, baseName);
      dataSource = 'docling_full_sections';
    } else if (propertyId && resolvedPropertyId) {
      const efResult = await db.query(
        `SELECT storage_path, section_type FROM extracted_files
         WHERE property_id = $1 AND deleted_at IS NULL`,
        [resolvedPropertyId]
      );
      if (efResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: `No extracted sections for propertyId ${resolvedPropertyId}`,
        });
      }
      const sections = {};
      for (const row of efResult.rows) {
        const filePath = path.join(process.cwd(), 'uploads', row.storage_path);
        try {
          sections[row.section_type] = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        } catch (e) {
          console.warn(`[FillHandler] Could not load ${row.storage_path}: ${e.message}`);
        }
      }
      dataToUse = await assembleFillPayload(sections);
      dataSource = 'property_sections';
    } else if (jsonPath) {
      const resolvedJsonPath = path.isAbsolute(jsonPath)
        ? jsonPath
        : path.resolve(EXTRACTED_DIR, jsonPath);

      try {
        const jsonContent = await fs.readFile(resolvedJsonPath, 'utf-8');
        dataToUse = JSON.parse(jsonContent);
        dataSource = 'jsonPath';
        // If caller pointed at a section file without structured_data, try baseName assembly
        if (!dataToUse.structured_data && jsonPath.includes('_subject_property.json')) {
          const bn = path.basename(jsonPath).replace('_subject_property.json', '');
          dataToUse = await assembleFillPayloadFromBaseName(EXTRACTED_DIR, bn);
          dataSource = 'docling_full_sections';
        }
      } catch (error) {
        return res.status(404).json({
          success: false,
          error: `JSON file not found or invalid: ${jsonPath}`,
        });
      }
    } else if (fileId) {
      const fileQuery = await db.query(
        'SELECT original_filename FROM files WHERE id = $1',
        [fileId]
      );

      if (fileQuery.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: `File not found in database: ${fileId}`,
        });
      }

      const { original_filename } = fileQuery.rows[0];
      const extractedFileName = `e_${path.basename(original_filename, path.extname(original_filename))}.json`;
      const extractedPath = path.join(EXTRACTED_DIR, extractedFileName);

      try {
        const jsonContent = await fs.readFile(extractedPath, 'utf-8');
        dataToUse = JSON.parse(jsonContent);
        dataSource = 'fileId_combined';
      } catch {
        // Prefer docling_full section set: find baseName from extracted files for this upload
        const files = await fs.readdir(EXTRACTED_DIR).catch(() => []);
        const subject = files.find(
          (f) => f.endsWith('_subject_property.json') && f.includes(String(fileId))
        );
        // Also match by original basename prefix
        const stem = path.basename(original_filename, path.extname(original_filename));
        const subjectByName =
          subject ||
          files.find((f) => f.endsWith('_subject_property.json') && f.includes(stem));

        if (!subjectByName) {
          return res.status(404).json({
            success: false,
            error: `Extracted JSON not found for file: ${original_filename}. Run docling_full extraction first.`,
          });
        }

        const bn = subjectByName.replace('_subject_property.json', '');
        dataToUse = await assembleFillPayloadFromBaseName(EXTRACTED_DIR, bn);
        dataSource = 'docling_full_sections';
      }

      // Resolve property from documents/files when not provided
      if (!resolvedPropertyId) {
        const propLink = await db.query(
          `SELECT d.property_id FROM documents d
           JOIN files f ON f.storage_path = d.storage_path
           WHERE f.id = $1 AND d.deleted_at IS NULL
           LIMIT 1`,
          [fileId]
        );
        if (propLink.rows.length > 0) {
          resolvedPropertyId = propLink.rows[0].property_id;
        }
      }
    }

    if (!dataToUse?.structured_data?.[0] && dataSource !== 'jsonData') {
      // Allow raw jsonData that already has structured_data; otherwise require adapter shape
      if (!dataToUse?.structured_data) {
        return res.status(400).json({
          success: false,
          error:
            'Fill data missing structured_data[0]. Use baseName/propertyId for docling_full sections, or a combined extract JSON.',
        });
      }
    }

    await fs.mkdir(FILLED_DIR, { recursive: true });

    const fillResult = await xlsxBridge.fillTemplate(resolvedTemplatePath, dataToUse, {
      outputPath: outputPath ? path.resolve(FILLED_DIR, outputPath) : undefined,
    });
    const result = xlsxBridge.formatFillReport(fillResult);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to fill template',
      });
    }

    const relativeOutputPath = path.relative(UPLOADS_DIR, result.outputPath);

    let generatedFile = null;
    if (resolvedPropertyId) {
      try {
        generatedFile = await propertyService.linkGeneratedFile(resolvedPropertyId, {
          fileType: 'xlsx',
          fileName: path.basename(result.outputPath),
          storagePath: relativeOutputPath.startsWith('filled/')
            ? relativeOutputPath
            : `filled/${path.basename(result.outputPath)}`,
          templateUsed: path.basename(resolvedTemplatePath),
        });
        console.log(
          `[FillHandler] Linked generated file to property ${resolvedPropertyId}:`,
          generatedFile.id
        );
      } catch (linkError) {
        console.error('[FillHandler] linkGeneratedFile failed:', linkError.message);
      }
    }

    res.json({
      success: true,
      message: result.message,
      outputPath: relativeOutputPath,
      absolutePath: result.outputPath,
      summary: result.summary,
      externalFields: result.externalFields,
      filledFields: result.filledFields?.length || 0,
      dataSource,
      propertyId: resolvedPropertyId,
      generatedFile: generatedFile
        ? { id: generatedFile.id, storagePath: generatedFile.storage_path }
        : null,
    });
  } catch (error) {
    console.error('[FillHandler] Fill error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
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

