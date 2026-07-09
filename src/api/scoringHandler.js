/**
 * Scoring API Handler
 * 
 * Provides REST API endpoints for property scoring operations:
 * - Calculate scores for properties
 * - Re-run scoring with new configuration
 * - Get/update scorecard configuration
 */

import express from 'express';
import { ScoringService, DEFAULT_SCORECARD_CONFIG } from '../services/scoring_service.js';
import { AddressExtractor } from '../services/address_extractor.js';
import { PropertyService } from '../services/property_service.js';
import { SECTION_TYPES } from '../services/costar_extract.js';
import {
  assemblePropertyData,
  getScoringService,
  ensureScoringConfigLoaded,
  SCORECARD_CONFIG_PATH,
} from '../services/property_data_assembler.js';
import { db } from '../config/database.js';
import fs from 'fs/promises';
import path from 'path';
import { 
  STATE_TO_REGION, 
  REGIONS, 
  getRegionForState, 
  getStatesInRegion, 
  getStateName, 
  getRegionName 
} from '../config/census_regions.js';

const router = express.Router();

// Shared ScoringService (loads saved config once) + other singletons
const scoringService = getScoringService();
ensureScoringConfigLoaded();
const addressExtractor = new AddressExtractor();
const propertyService = new PropertyService();

/**
 * POST /api/scoring/calculate
 * 
 * Calculate score for a single property.
 * 
 * Request Body:
 * {
 *   "propertyData": { ... combined property data ... }
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "score": 7.2,
 *   "decision": "Move Forward",
 *   "breakdown": { ... }
 * }
 */
router.post('/calculate', async (req, res) => {
  try {
    const { propertyData } = req.body;

    if (!propertyData) {
      return res.status(400).json({
        success: false,
        error: 'Missing propertyData in request body',
      });
    }

    const result = scoringService.calculateScore(propertyData);

    res.json({
      success: true,
      ...result,
    });

  } catch (error) {
    console.error('[Scoring] Calculate error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/scoring/calculate-batch
 * 
 * Calculate scores for multiple properties.
 * 
 * Request Body:
 * {
 *   "properties": [{ ... }, { ... }]
 * }
 */
router.post('/calculate-batch', async (req, res) => {
  try {
    const { properties } = req.body;

    if (!properties || !Array.isArray(properties)) {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid properties array in request body',
      });
    }

    const results = scoringService.calculateBatchScores(properties);
    const summary = scoringService.getSummaryStatistics(results);

    res.json({
      success: true,
      count: results.length,
      summary,
      properties: results,
    });

  } catch (error) {
    console.error('[Scoring] Batch calculate error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/scoring/recalculate
 * 
 * Re-run scoring with a new configuration.
 * 
 * Request Body:
 * {
 *   "propertyData": { ... },
 *   "config": { ... new scorecard config ... }
 * }
 */
router.post('/recalculate', async (req, res) => {
  try {
    const { propertyData, config } = req.body;

    if (!propertyData) {
      return res.status(400).json({
        success: false,
        error: 'Missing propertyData in request body',
      });
    }

    // Create temporary service with new config
    const tempService = new ScoringService(config || scoringService.getConfig());
    const result = tempService.calculateScore(propertyData);

    res.json({
      success: true,
      ...result,
      configUsed: config ? 'custom' : 'default',
    });

  } catch (error) {
    console.error('[Scoring] Recalculate error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/scoring/config
 * 
 * Get the current scorecard configuration.
 */
router.get('/config', async (req, res) => {
  try {
    const config = scoringService.getConfig();
    const validation = scoringService.validateConfig();

    res.json({
      success: true,
      config,
      validation,
    });

  } catch (error) {
    console.error('[Scoring] Get config error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/scoring/config
 * 
 * Update the scorecard configuration.
 * 
 * Request Body:
 * {
 *   "factors": { ... },
 *   "thresholds": { ... }
 * }
 */
router.put('/config', async (req, res) => {
  try {
    const newConfig = req.body;

    // Validate before applying
    const tempService = new ScoringService(newConfig);
    const validation = tempService.validateConfig();

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.message,
        validation,
      });
    }

    // Apply to main service
    scoringService.updateConfig(newConfig);

    // Save to file
    await fs.mkdir(path.dirname(SCORECARD_CONFIG_PATH), { recursive: true });
    await fs.writeFile(SCORECARD_CONFIG_PATH, JSON.stringify(scoringService.getConfig(), null, 2));

    res.json({
      success: true,
      message: 'Configuration updated and saved',
      config: scoringService.getConfig(),
    });

  } catch (error) {
    console.error('[Scoring] Update config error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/scoring/config/reset
 * 
 * Reset scorecard configuration to defaults.
 */
router.post('/config/reset', async (req, res) => {
  try {
    scoringService.resetToDefaults();

    // Remove saved config file
    try {
      await fs.unlink(SCORECARD_CONFIG_PATH);
    } catch (e) {
      // Ignore if file doesn't exist
    }

    res.json({
      success: true,
      message: 'Configuration reset to defaults',
      config: scoringService.getConfig(),
    });

  } catch (error) {
    console.error('[Scoring] Reset config error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/scoring/defaults
 * 
 * Get the default scorecard configuration.
 */
router.get('/defaults', async (req, res) => {
  try {
    res.json({
      success: true,
      config: DEFAULT_SCORECARD_CONFIG,
    });

  } catch (error) {
    console.error('[Scoring] Get defaults error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/scoring/extract-address
 * 
 * Extract address from Docling JSON output.
 * 
 * Request Body:
 * {
 *   "subjectPropertyData": { ... subject_property JSON ... }
 * }
 */
router.post('/extract-address', async (req, res) => {
  try {
    const { subjectPropertyData } = req.body;

    if (!subjectPropertyData) {
      return res.status(400).json({
        success: false,
        error: 'Missing subjectPropertyData in request body',
      });
    }

    const address = addressExtractor.extractFromSubjectProperty(subjectPropertyData);

    res.json({
      success: true,
      address,
    });

  } catch (error) {
    console.error('[Scoring] Extract address error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/scoring/properties
 * 
 * Get all scored properties. 
 * Primary source: Database (fast, persisted scores)
 * Fallback: File-based scanning (for backward compatibility before migration)
 * 
 * Query Parameters:
 * - source: 'db' (default) or 'files' (force file-based scanning)
 * - includeDeleted: 'true' to include soft-deleted properties
 */
router.get('/properties', async (req, res) => {
  try {
    const source = req.query.source || 'db';
    const includeDeleted = req.query.includeDeleted === 'true';

    // PropertyService is the sole facade. File-scan is opt-in only (deprecated).
    if (source === 'files') {
      console.warn('[Scoring] DEPRECATED: source=files file-scan. Prefer DB + scripts/backfill_properties.js');
      return await listPropertiesFromFiles(req, res);
    }

    try {
      const dbProperties = await propertyService.getAllWithScores({ includeDeleted });

      if (dbProperties.length === 0) {
        return res.json({
          success: true,
          source: 'database',
          count: 0,
          summary: await propertyService.getSummaryStats(),
          properties: [],
          message:
            'No properties in database. Run extraction (docling_full) or scripts/backfill_properties.js. File-scan fallback is disabled by default; use ?source=files only for emergency inspection.',
        });
      }

      const extractionIds = {};
      for (const p of dbProperties) {
        const efResult = await db.query(
          'SELECT storage_path FROM extracted_files WHERE property_id = $1 AND deleted_at IS NULL LIMIT 1',
          [p.id]
        );
        if (efResult.rows.length > 0) {
          const storagePath = efResult.rows[0].storage_path;
          const filename = storagePath.split('/').pop();
          const match = filename.match(/^(e_\d+-[a-z0-9]+)_/);
          extractionIds[p.id] = match ? match[1] : null;
        }
      }

      const properties = dbProperties.map(p => ({
        id: p.id,
        propertyName: p.name,
        address: {
          street: p.address_street,
          city: p.address_city,
          state: p.address_state,
          stateAbbr: p.address_state_abbr,
          zipCode: p.address_zip,
          fullAddress: p.address_full
        },
        score: p.score ? parseFloat(p.score) : null,
        decision: p.decision,
        decisionColor: p.decision_color,
        breakdown: p.breakdown,
        calculatedAt: p.calculated_at,
        createdAt: p.created_at,
        deletedAt: p.deleted_at,
        status: p.status,
        extractionId: extractionIds[p.id] || null
      }));

      const summary = await propertyService.getSummaryStats();

      return res.json({
        success: true,
        source: 'database',
        count: properties.length,
        summary,
        properties,
      });
    } catch (dbError) {
      console.error('[Scoring] Database error listing properties:', dbError.message);
      return res.status(500).json({
        success: false,
        error: dbError.message,
        message: 'Database unavailable. Fix DB connection; do not rely on file-scan identity.',
      });
    }

  } catch (error) {
    console.error('[Scoring] Get properties error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DEPRECATED: file-scan property listing (e_* string ids).
 * Kept behind ?source=files for emergency inspection until all data is backfilled.
 */
async function listPropertiesFromFiles(req, res) {
  const extractedDir = path.join(process.cwd(), 'uploads', 'extracted');

  let files;
  try {
    files = await fs.readdir(extractedDir);
  } catch (e) {
    files = [];
  }

  const properties = [];
  const propertyGroups = new Map();

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    let baseName = file;
    let isSection = false;

    for (const sectionType of SECTION_TYPES) {
      if (file.includes(`_${sectionType}.json`)) {
        baseName = file.replace(`_${sectionType}.json`, '');
        isSection = true;
        break;
      }
    }

    if (!isSection) {
      baseName = file.replace('.json', '');
    }

    if (!propertyGroups.has(baseName)) {
      propertyGroups.set(baseName, { files: [], sections: {} });
    }

    propertyGroups.get(baseName).files.push(file);
  }

  for (const [baseName, group] of propertyGroups) {
    try {
      const sections = {};
      let combinedData = null;

      for (const file of group.files) {
        const filePath = path.join(extractedDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);

        for (const sectionType of SECTION_TYPES) {
          if (file.includes(`_${sectionType}.json`)) {
            sections[sectionType] = data;
            break;
          }
        }

        if (!Object.keys(sections).some(s => file.includes(`_${s}.json`))) {
          combinedData = data;
        }
      }

      const hasPropertyData = sections.subject_property || sections.demographics ||
                              sections.construction || combinedData;
      if (!hasPropertyData) {
        continue;
      }

      const subjectData = sections.subject_property || combinedData;
      const address = addressExtractor.extractFromSubjectProperty(subjectData);

      let externalData = sections.external;
      if (!externalData) {
        const externalDataPath = path.join(extractedDir, `${baseName}_external.json`);
        try {
          externalData = JSON.parse(await fs.readFile(externalDataPath, 'utf-8'));
        } catch (e) {
          externalData = { crime: {}, schools: {}, walkScore: {} };
        }
      }

      const propertyData = {
        id: baseName,
        propertyName: address.propertyName || baseName.replace('e_', ''),
        ...assemblePropertyData(sections, address, externalData),
        rawSections: sections,
        rawCombined: combinedData,
      };

      const scoreResult = scoringService.calculateScore(propertyData);

      properties.push({
        id: baseName,
        propertyName: propertyData.propertyName,
        address: address,
        ...scoreResult,
      });

    } catch (e) {
      console.error(`[Scoring] Error processing ${baseName}:`, e.message);
    }
  }

  const summary = scoringService.getSummaryStatistics(properties);

  return res.json({
    success: true,
    source: 'files',
    deprecated: true,
    count: properties.length,
    summary,
    properties,
    message: 'DEPRECATED file-scan identity (e_* ids). Backfill into PropertyService and use source=db.',
  });
}

router.get('/aggregate', async (req, res) => {
  try {
    const { groupBy = 'region', region, state, city } = req.query;
    
    // Get all active properties with scores from database
    const dbProperties = await propertyService.getAllWithScores({ includeDeleted: false });
    
    // Build breadcrumb based on current filters
    const breadcrumb = [{ level: 0, label: 'All Regions', key: null }];
    
    if (region) {
      breadcrumb.push({ level: 1, label: getRegionName(region), key: region });
    }
    if (state) {
      breadcrumb.push({ level: 2, label: getStateName(state), key: state });
    }
    if (city) {
      breadcrumb.push({ level: 3, label: city, key: city });
    }
    
    // Filter properties based on current selection
    let filteredProperties = dbProperties.map(p => ({
      id: p.id,
      propertyName: p.name,
      address: {
        street: p.address_street,
        city: p.address_city,
        state: p.address_state,
        stateAbbr: p.address_state_abbr,
        zipCode: p.address_zip,
        fullAddress: p.address_full
      },
      score: p.score ? parseFloat(p.score) : null,
      decision: p.decision,
      decisionColor: p.decision_color,
      breakdown: p.breakdown,
      region: getRegionForState(p.address_state_abbr)
    }));
    
    // Apply filters
    if (region) {
      filteredProperties = filteredProperties.filter(p => p.region === region.toLowerCase());
    }
    if (state) {
      filteredProperties = filteredProperties.filter(p => 
        p.address.stateAbbr?.toUpperCase() === state.toUpperCase()
      );
    }
    if (city) {
      filteredProperties = filteredProperties.filter(p => 
        p.address.city?.toLowerCase() === city.toLowerCase()
      );
    }
    
    // Aggregate based on groupBy level
    let groups = [];
    let currentLevel = 0;
    
    if (groupBy === 'region') {
      // Group by Census regions
      currentLevel = 0;
      const regionCounts = {};
      
      for (const regionKey of Object.keys(REGIONS)) {
        regionCounts[regionKey] = { moveForward: 0, needsReview: 0, rejected: 0, total: 0 };
      }
      
      for (const p of filteredProperties) {
        const regionKey = p.region;
        if (!regionKey || !regionCounts[regionKey]) continue;
        
        regionCounts[regionKey].total++;
        if (p.decisionColor === 'green') {
          regionCounts[regionKey].moveForward++;
        } else if (p.decisionColor === 'yellow') {
          regionCounts[regionKey].needsReview++;
        } else {
          regionCounts[regionKey].rejected++;
        }
      }
      
      groups = Object.entries(REGIONS).map(([key, region]) => ({
        key,
        name: region.name,
        ...regionCounts[key]
      })).filter(g => g.total > 0);
      
    } else if (groupBy === 'state') {
      // Group by states within region
      currentLevel = 1;
      const stateCounts = {};
      
      for (const p of filteredProperties) {
        const stateAbbr = p.address.stateAbbr?.toUpperCase();
        if (!stateAbbr) continue;
        
        if (!stateCounts[stateAbbr]) {
          stateCounts[stateAbbr] = { 
            key: stateAbbr, 
            name: getStateName(stateAbbr),
            moveForward: 0, 
            needsReview: 0, 
            rejected: 0, 
            total: 0 
          };
        }
        
        stateCounts[stateAbbr].total++;
        if (p.decisionColor === 'green') {
          stateCounts[stateAbbr].moveForward++;
        } else if (p.decisionColor === 'yellow') {
          stateCounts[stateAbbr].needsReview++;
        } else {
          stateCounts[stateAbbr].rejected++;
        }
      }
      
      groups = Object.values(stateCounts).sort((a, b) => b.total - a.total);
      
    } else if (groupBy === 'city') {
      // Group by cities within state
      currentLevel = 2;
      const cityCounts = {};
      
      for (const p of filteredProperties) {
        const cityName = p.address.city;
        if (!cityName) continue;
        
        const cityKey = cityName.toLowerCase().replace(/\s+/g, '_');
        
        if (!cityCounts[cityKey]) {
          cityCounts[cityKey] = { 
            key: cityKey, 
            name: cityName,
            moveForward: 0, 
            needsReview: 0, 
            rejected: 0, 
            total: 0 
          };
        }
        
        cityCounts[cityKey].total++;
        if (p.decisionColor === 'green') {
          cityCounts[cityKey].moveForward++;
        } else if (p.decisionColor === 'yellow') {
          cityCounts[cityKey].needsReview++;
        } else {
          cityCounts[cityKey].rejected++;
        }
      }
      
      groups = Object.values(cityCounts).sort((a, b) => b.total - a.total);
      
    } else if (groupBy === 'property') {
      // Return individual properties (deepest level)
      currentLevel = 3;
      groups = filteredProperties.map(p => ({
        key: String(p.id),
        name: p.propertyName || 'Unknown Property',
        score: p.score,
        decisionColor: p.decisionColor,
        moveForward: p.decisionColor === 'green' ? 1 : 0,
        needsReview: p.decisionColor === 'yellow' ? 1 : 0,
        rejected: p.decisionColor === 'red' ? 1 : 0,
        total: 1
      })).sort((a, b) => (b.score || 0) - (a.score || 0));
    }
    
    // Calculate summary for current filter level
    const summary = {
      total: filteredProperties.length,
      moveForward: filteredProperties.filter(p => p.decisionColor === 'green').length,
      needsReview: filteredProperties.filter(p => p.decisionColor === 'yellow').length,
      rejected: filteredProperties.filter(p => p.decisionColor === 'red').length,
    };
    
    res.json({
      success: true,
      currentLevel,
      groupBy,
      breadcrumb,
      groups,
      summary,
      filteredProperties
    });
    
  } catch (error) {
    console.error('[Scoring] Aggregate error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/scoring/rescore
 * 
 * Recalculate scores for all properties using current config.
 * Call this after changing scorecard configuration.
 */
router.post('/rescore', async (req, res) => {
  try {
    await ensureScoringConfigLoaded();
    // Get all properties from database
    const dbProperties = await propertyService.getAllWithScores({ includeDeleted: false });
    
    let rescored = 0;
    let errors = 0;

    for (const property of dbProperties) {
      try {
        // Load extracted files for this property
        const extractedFiles = await db.query(
          'SELECT * FROM extracted_files WHERE property_id = $1 AND deleted_at IS NULL',
          [property.id]
        );

        const sections = {};
        for (const ef of extractedFiles.rows) {
          try {
            const filePath = path.join(process.cwd(), 'uploads', ef.storage_path);
            const content = await fs.readFile(filePath, 'utf-8');
            sections[ef.section_type] = JSON.parse(content);
          } catch (e) {
            console.warn(`[Rescore] Could not load ${ef.storage_path}: ${e.message}`);
          }
        }

        const subjectData = sections.subject_property;
        const address = subjectData ? addressExtractor.extractFromSubjectProperty(subjectData) : {
          street: property.address_street,
          city: property.address_city,
          state: property.address_state,
          stateAbbr: property.address_state_abbr,
          zipCode: property.address_zip,
          fullAddress: property.address_full
        };

        const propertyData = assemblePropertyData(sections, address);

        // Recalculate score
        const scoreResult = scoringService.calculateScore(propertyData);

        // Save new score
        await propertyService.saveScore(
          property.id,
          scoreResult,
          propertyData,
          scoringService.getConfig()
        );

        rescored++;
      } catch (e) {
        console.error(`[Rescore] Error rescoring property ${property.id}:`, e.message);
        errors++;
      }
    }

    // Get updated summary
    const summary = await propertyService.getSummaryStats();

    res.json({
      success: true,
      message: `Rescored ${rescored} properties`,
      rescored,
      errors,
      summary
    });

  } catch (error) {
    console.error('[Scoring] Rescore error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


export default router;
