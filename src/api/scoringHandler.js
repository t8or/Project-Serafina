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
import { db } from '../config/database.js';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

// Singleton service instances
let scoringService = new ScoringService();
const addressExtractor = new AddressExtractor();
const propertyService = new PropertyService();

// Path to store scorecard configuration
const CONFIG_PATH = path.join(process.cwd(), 'uploads', 'config', 'scorecard_config.json');

/**
 * Load saved configuration from file if exists.
 */
async function loadSavedConfig() {
  try {
    const configData = await fs.readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(configData);
    scoringService.updateConfig(config);
    console.log('[Scoring] Loaded saved scorecard configuration');
  } catch (error) {
    console.log('[Scoring] No saved configuration found, using defaults');
  }
}

// Load config on startup
loadSavedConfig();

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
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(scoringService.getConfig(), null, 2));

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
      await fs.unlink(CONFIG_PATH);
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

    // Try database first (default)
    if (source === 'db') {
      try {
        const dbProperties = await propertyService.getAllWithScores({ includeDeleted });
        
        if (dbProperties.length > 0) {
          // Format properties for API response
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
            status: p.status
          }));

          // Get summary from database
          const summary = await propertyService.getSummaryStats();

          return res.json({
            success: true,
            source: 'database',
            count: properties.length,
            summary,
            properties,
          });
        }
        
        console.log('[Scoring] No properties in database, falling back to file-based scanning');
      } catch (dbError) {
        console.error('[Scoring] Database error, falling back to file-based:', dbError.message);
      }
    }

    // Fallback to file-based scanning (original logic)
    const extractedDir = path.join(process.cwd(), 'uploads', 'extracted');
    
    // Read all extracted JSON files
    let files;
    try {
      files = await fs.readdir(extractedDir);
    } catch (e) {
      files = [];
    }

    const properties = [];
    
    // Section types we look for in full Docling output (including external data)
    const SECTION_TYPES = ['subject_property', 'demographics', 'rent_comps', 'construction', 
                           'sale_comps', 'submarket_report', 'market_report', 'unknown', 'external'];
    
    // Group files by property (base name before section suffix)
    const propertyGroups = new Map();
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      // Check if this is a section file (e.g., e_12345_demographics.json)
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
        // This is a standalone file (old format or single-file output)
        baseName = file.replace('.json', '');
      }
      
      if (!propertyGroups.has(baseName)) {
        propertyGroups.set(baseName, { files: [], sections: {} });
      }
      
      propertyGroups.get(baseName).files.push(file);
    }

    // Process each property group
    for (const [baseName, group] of propertyGroups) {
      try {
        // Load all section files for this property
        const sections = {};
        let combinedData = null;
        
        for (const file of group.files) {
          const filePath = path.join(extractedDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);
          
          // Determine section type
          for (const sectionType of SECTION_TYPES) {
            if (file.includes(`_${sectionType}.json`)) {
              sections[sectionType] = data;
              break;
            }
          }
          
          // If not a section file, it's the combined/main file
          if (!Object.keys(sections).some(s => file.includes(`_${s}.json`))) {
            combinedData = data;
          }
        }

        // Skip property groups that only have external data (no actual property info)
        const hasPropertyData = sections.subject_property || sections.demographics || 
                                sections.construction || combinedData;
        if (!hasPropertyData) {
          console.log(`[Scoring] Skipping ${baseName} - only has external data, no property sections`);
          continue;
        }

        // Extract address from subject_property section or combined data
        const subjectData = sections.subject_property || combinedData;
        const address = addressExtractor.extractFromSubjectProperty(subjectData);
        
        // Extract demographics data - 3-mile data is typically in submarket_report
        const demographicsData = extractDemographicsFromDocling(sections.demographics, sections.submarket_report);
        
        // Extract submarket data - vacancy, construction % from construction/demographics sections
        // Note: The "Current Quarter" table with Submarket row can be in construction OR demographics
        const submarketData = extractSubmarketFromDocling(sections.submarket_report, sections.construction, sections.demographics);
        
        // Extract property-specific data (Walk Score, etc.) from subject_property
        const propertyMetrics = extractPropertyMetricsFromDocling(sections.subject_property);
        
        console.log(`[Scoring] Processing ${baseName}:`, { demographicsData, submarketData, propertyMetrics });

        // Load external data (crime, schools, walkScore) - scraping happens during document extraction, not here
        let externalData = { crime: {}, schools: {}, walkScore: {} };
        
        // Check if external data was loaded as a section file
        if (sections.external) {
          externalData = sections.external;
          console.log(`[Scoring] Using external data from section file for ${baseName}`);
        } else {
          // Check for existing scraped data file
          const externalDataPath = path.join(extractedDir, `${baseName}_external.json`);
          try {
            const existingData = await fs.readFile(externalDataPath, 'utf-8');
            externalData = JSON.parse(existingData);
            console.log(`[Scoring] Loaded existing external data file for ${baseName}`);
          } catch (e) {
            // No external data available - scraping should have happened during extraction
            console.log(`[Scoring] No external data found for ${baseName} - run extraction with scraping enabled`);
          }
        }

        // Build property data structure for scoring
        const propertyData = {
          id: baseName,
          propertyName: address.propertyName || baseName.replace('e_', ''),
          address,
          demographics: demographicsData,
          property: propertyMetrics,
          submarket: submarketData,
          external: externalData,
          rawSections: sections,
          rawCombined: combinedData,
        };

        // Calculate score
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

    // Calculate summary
    const summary = scoringService.getSummaryStatistics(properties);

    res.json({
      success: true,
      source: 'files',
      count: properties.length,
      summary,
      properties,
    });

  } catch (error) {
    console.error('[Scoring] Get properties error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
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
    const extractedDir = path.join(process.cwd(), 'uploads', 'extracted');
    const SECTION_TYPES = ['subject_property', 'demographics', 'rent_comps', 'construction', 
                           'sale_comps', 'submarket_report', 'market_report', 'unknown', 'external'];

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

        // Extract data from sections
        const subjectData = sections.subject_property;
        const address = subjectData ? addressExtractor.extractFromSubjectProperty(subjectData) : {
          street: property.address_street,
          city: property.address_city,
          state: property.address_state,
          stateAbbr: property.address_state_abbr,
          zipCode: property.address_zip,
          fullAddress: property.address_full
        };

        const demographicsData = extractDemographicsFromDocling(sections.demographics, sections.submarket_report);
        const submarketData = extractSubmarketFromDocling(sections.submarket_report, sections.construction, sections.demographics);
        const propertyMetrics = extractPropertyMetricsFromDocling(sections.subject_property);

        const propertyData = {
          address,
          demographics: demographicsData,
          property: propertyMetrics,
          submarket: submarketData,
          external: sections.external || {}
        };

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

/**
 * Parse markdown table string into rows of data.
 * Returns array of objects with column headers as keys.
 */
function parseMarkdownTable(markdown) {
  if (!markdown) return [];
  
  const lines = markdown.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  
  // Parse header row (first line with |)
  const headerLine = lines.find(l => l.includes('|') && !l.match(/^\|[\s-:|]+\|$/));
  if (!headerLine) return [];
  
  const headers = headerLine.split('|')
    .map(h => h.trim())
    .filter(h => h && !h.match(/^-+$/));
  
  const rows = [];
  
  // Parse data rows
  for (const line of lines) {
    if (line.match(/^\|[\s-:|]+\|$/) || line === headerLine) continue;
    if (!line.includes('|')) continue;
    
    const cells = line.split('|').map(c => c.trim()).filter((c, i) => i > 0 && i <= headers.length);
    
    if (cells.length > 0) {
      const row = {};
      headers.forEach((h, i) => {
        row[h] = cells[i] || '';
      });
      rows.push(row);
    }
  }
  
  return rows;
}

/**
 * Find value in a table by row label and column name.
 * More precise matching - requires exact column name match if provided.
 */
function findTableValue(tables, rowLabel, columnName) {
  for (const table of tables) {
    if (table.markdown) {
      const rows = parseMarkdownTable(table.markdown);
      for (const row of rows) {
        const rowKeys = Object.keys(row);
        const rowValues = Object.values(row);
        const firstCell = rowValues[0] || '';
        
        // Check if first cell matches the row label
        if (String(firstCell).toLowerCase().includes(rowLabel.toLowerCase())) {
          // If columnName specified, find that exact column
          if (columnName) {
            for (const [key, value] of Object.entries(row)) {
              if (key.toLowerCase().trim() === columnName.toLowerCase().trim()) {
                return value;
              }
            }
            // Try partial match on column name
            for (const [key, value] of Object.entries(row)) {
              if (key.toLowerCase().includes(columnName.toLowerCase())) {
                return value;
              }
            }
          }
          // If no column match, return second value (often the data column)
          if (rowValues.length > 1) {
            return rowValues[1];
          }
        }
      }
    }
    
    // Also check rows array if present
    if (table.rows) {
      for (const row of table.rows) {
        // Check if any value in the row matches the row label
        const rowValues = Object.values(row);
        const firstValue = rowValues[0] || '';
        
        if (String(firstValue).toLowerCase().includes(rowLabel.toLowerCase())) {
          // If columnName specified, look for that column
          if (columnName && row[columnName] !== undefined) {
            return row[columnName];
          }
          // Try case-insensitive column match
          for (const [key, value] of Object.entries(row)) {
            if (columnName && key.toLowerCase().includes(columnName.toLowerCase())) {
              return value;
            }
          }
          // Return first numeric-looking value after the label
          for (let i = 1; i < rowValues.length; i++) {
            if (String(rowValues[i]).match(/[\d$%]/)) {
              return rowValues[i];
            }
          }
        }
      }
    }
  }
  return null;
}

/**
 * Parse a numeric value from various formats ($123,456 or 12.5% or 123,456)
 */
function parseNumericValue(value, isPercentage = false) {
  if (!value) return null;
  const str = String(value).replace(/[$,]/g, '').trim();
  
  if (str === '-' || str === '') return null;
  
  const match = str.match(/([-\d.]+)%?/);
  if (match) {
    const num = parseFloat(match[1]);
    // If it's a percentage value, divide by 100
    if (isPercentage || str.includes('%')) {
      return num / 100;
    }
    return num;
  }
  return null;
}

/**
 * Extract demographics data from Docling sections.
 * The 3-mile demographics are typically in the submarket_report section.
 */
function extractDemographicsFromDocling(demographicsSection, submarketSection) {
  const result = {};
  
  // Collect all tables from both sections
  const allTables = [];
  
  if (submarketSection) {
    // Tables in the submarket section often have 3-mile demographics
    if (submarketSection.tables) {
      allTables.push(...submarketSection.tables);
    }
    // Also check pages for tables
    const pages = submarketSection.pages || [];
    for (const page of pages) {
      if (page.tables) allTables.push(...page.tables);
    }
  }
  
  if (demographicsSection) {
    if (demographicsSection.tables) {
      allTables.push(...demographicsSection.tables);
    }
    const pages = demographicsSection.pages || [];
    for (const page of pages) {
      if (page.tables) allTables.push(...page.tables);
    }
  }
  
  // Look for 3-mile demographics in tables
  // Format: Row label | 1 Mile | 3 Mile | ...
  // Also check for "3 Mile" as a row key in structured table data
  
  // First check if there's structured table data with "3 Mile" column
  for (const table of allTables) {
    if (table.rows) {
      for (const row of table.rows) {
        const rowLabel = Object.values(row)[0] || '';
        const threeValue = row['3 Mile'];
        
        if (threeValue && threeValue !== '') {
          const label = String(rowLabel).toLowerCase();
          
          if (label.includes('2024 population') || label === 'population') {
            const val = parseNumericValue(threeValue);
            if (val && val > 1000) result.population_3mile = val; // Sanity check
          }
          if (label.includes('pop growth') || label.includes('population growth') || label.includes('household growth')) {
            result.population_growth_3mile = parseNumericValue(threeValue, true);
          }
          if (label.includes('median household income') || label.includes('median hh income')) {
            result.median_hh_income_3mile = parseNumericValue(threeValue);
          }
          if (label.includes('median home value')) {
            result.median_home_value_3mile = parseNumericValue(threeValue);
          }
          if (label.includes('renter')) {
            result.renter_households_pct_3mile = parseNumericValue(threeValue, true);
          }
        }
      }
    }
  }
  
  // Fallback to markdown table parsing if not found
  if (!result.population_3mile) {
    const pop = findTableValue(allTables, '2024 Population', '3 Mile');
    if (pop) result.population_3mile = parseNumericValue(pop);
  }
  
  if (!result.population_growth_3mile) {
    const popGrowth = findTableValue(allTables, 'Pop Growth', '3 Mile') ||
                      findTableValue(allTables, 'Population Growth', '3 Mile') ||
                      findTableValue(allTables, 'Household Growth', '3 Mile');
    if (popGrowth) result.population_growth_3mile = parseNumericValue(popGrowth, true);
  }
  
  if (!result.median_hh_income_3mile) {
    const income = findTableValue(allTables, 'Median Household Income', '3 Mile') ||
                   findTableValue(allTables, 'Median HH Income', '3 Mile');
    if (income) result.median_hh_income_3mile = parseNumericValue(income);
  }
  
  if (!result.median_home_value_3mile) {
    const homeValue = findTableValue(allTables, 'Median Home Value', '3 Mile');
    if (homeValue) result.median_home_value_3mile = parseNumericValue(homeValue);
  }
  
  // Renter households percentage - often needs to be looked up separately
  if (!result.renter_households_pct_3mile) {
    const renterPct = findTableValue(allTables, 'Renter', '3 Mile') ||
                      findTableValue(allTables, 'Renter Occupied', '3 Mile') ||
                      findTableValue(allTables, 'Renter Households', '3 Mile');
    if (renterPct) result.renter_households_pct_3mile = parseNumericValue(renterPct, true);
  }
  
  // If not found in tables, search text for demographics
  const allText = [];
  if (demographicsSection?.pages) {
    for (const page of demographicsSection.pages) {
      for (const item of (page.text_items || [])) {
        allText.push(item.text || '');
      }
    }
  }
  
  const combinedText = allText.join(' ');
  
  // Try to extract from text if not found in tables
  if (!result.renter_households_pct_3mile) {
    // Look for patterns like "60% of households now rent" or "renter: 48%"
    const renterMatch = combinedText.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:households?\s+)?(?:now\s+)?rent/i) ||
                        combinedText.match(/rent(?:er|al)?[:\s]+(\d+(?:\.\d+)?)\s*%/i);
    if (renterMatch) {
      result.renter_households_pct_3mile = parseFloat(renterMatch[1]) / 100;
    }
  }
  
  console.log('[Scoring] Extracted demographics:', result);
  return result;
}

/**
 * Extract submarket analytics data from Docling sections.
 * Looks for the "Current Quarter" table with "Submarket" row.
 * NOTE: This table can be in construction, demographics, OR submarket_report sections.
 * 
 * Key table format:
 * | Current Quarter | Units  | Vacancy Rate | ... | Delivered Units | Under Constr Units |
 * | Submarket       | 31,741 | 8.6%         | ... | 0               | 507                |
 * | Delivered Units | 1,086  | ...          |     |                 |                    |
 * 
 * Delivered % = 12 Month Delivered Units (from "Delivered Units" row) / Total Units
 * Construction % = Under Constr Units (from "Submarket" row) / Total Units
 */
function extractSubmarketFromDocling(submarketSection, constructionSection, demographicsSection = null) {
  const result = {};
  
  // Collect all tables from ALL relevant sections (demographics often has the key data)
  const allTables = [];
  const allText = [];
  
  // Include demographics section - it often contains the submarket metrics table
  for (const section of [constructionSection, submarketSection, demographicsSection]) {
    if (!section) continue;
    
    if (section.tables) {
      allTables.push(...section.tables);
    }
    
    const pages = section.pages || [];
    for (const page of pages) {
      if (page.tables) allTables.push(...page.tables);
      for (const item of (page.text_items || [])) {
        allText.push(item.text || '');
      }
    }
  }
  
  console.log(`[Scoring] Submarket extraction: found ${allTables.length} tables from ${[constructionSection, submarketSection, demographicsSection].filter(Boolean).length} sections`);
  
  // First, try to find vacancy from text
  const combinedText = allText.join(' ');
  const vacMatch = combinedText.match(/(?:submarket['s]?\s+)?vacancy\s+(?:rate\s+)?(?:of\s+|has\s+\w+\s+to\s+|is\s+|at\s+)?(\d+(?:\.\d+)?)\s*%/i);
  if (vacMatch) {
    result.vacancy_rate = parseFloat(vacMatch[1]) / 100;
    console.log(`[Scoring] Found vacancy from text: ${vacMatch[1]}%`);
  }
  
  // Track data from the "Current Quarter" table
  let submarketTotalUnits = null;
  let submarketUnderConstr = null;
  let twelveMonthDelivered = null;
  
  // Strategy: Find the table with "Current Quarter" column
  // This table has "Submarket" row (totals) and "Delivered Units" row (12-month)
  for (const table of allTables) {
    if (!table.rows) continue;
    
    const tableHeaders = table.headers || (table.rows[0] ? Object.keys(table.rows[0]) : []);
    if (!tableHeaders.includes('Current Quarter')) continue;
    
    console.log(`[Scoring] Found table with Current Quarter, ${table.rows.length} rows`);
    
    for (const row of table.rows) {
      const currentQuarter = row['Current Quarter'] || '';
      
      // "Submarket" row has total units, vacancy, and under construction
      if (currentQuarter === 'Submarket' || currentQuarter.toLowerCase() === 'submarket') {
        submarketTotalUnits = parseNumericValue(row['Units']);
        submarketUnderConstr = parseNumericValue(row['Under Constr Units']);
        const vacancyRate = parseNumericValue(row['Vacancy Rate'], true);
        
        console.log('[Scoring] Found Submarket row:', { 
          totalUnits: submarketTotalUnits, 
          underConstr: submarketUnderConstr, 
          vacancy: vacancyRate 
        });
        
        if (!result.vacancy_rate && vacancyRate) {
          result.vacancy_rate = vacancyRate;
        }
      }
      
      // "Delivered Units" row has 12-month delivered (in the "Units" column)
      if (currentQuarter === 'Delivered Units') {
        twelveMonthDelivered = parseNumericValue(row['Units']);
        console.log('[Scoring] Found 12-month Delivered Units:', twelveMonthDelivered);
      }
    }
    
    // If we found submarket data in this table, calculate percentages
    if (submarketTotalUnits && submarketTotalUnits > 0) {
      // Delivered % = 12 Month Delivered / Total Units
      if (twelveMonthDelivered !== null) {
        result.delivered_pct_of_inventory = twelveMonthDelivered / submarketTotalUnits;
        console.log(`[Scoring] Delivered %: ${twelveMonthDelivered}/${submarketTotalUnits} = ${(result.delivered_pct_of_inventory * 100).toFixed(2)}%`);
      }
      
      // Construction % = Under Construction / Total Units
      if (submarketUnderConstr !== null) {
        result.construction_pct_of_inventory = submarketUnderConstr / submarketTotalUnits;
        console.log(`[Scoring] Construction %: ${submarketUnderConstr}/${submarketTotalUnits} = ${(result.construction_pct_of_inventory * 100).toFixed(2)}%`);
      }
      
      break; // Found our data, stop searching
    }
  }
  
  // Fallback: Look for "Percent of Inventory" in table with Under Construction summary
  if (result.construction_pct_of_inventory === undefined) {
    for (const table of allTables) {
      if (!table.rows) continue;
      
      for (const row of table.rows) {
        const pctOfInv = row['Percent of Inventory'];
        if (pctOfInv) {
          // This is likely the under construction summary
          result.construction_pct_of_inventory = parseNumericValue(pctOfInv, true);
          console.log(`[Scoring] Found Construction % from Percent of Inventory: ${pctOfInv}`);
          break;
        }
      }
      if (result.construction_pct_of_inventory !== undefined) break;
    }
  }
  
  // If not found in text, try table lookup with specific column
  if (!result.vacancy_rate) {
    const vacancyFromTable = findTableValue(allTables, 'Submarket', 'Vacancy Rate');
    if (vacancyFromTable) {
      result.vacancy_rate = parseNumericValue(vacancyFromTable, true);
    }
  }
  
  console.log('[Scoring] Extracted submarket data:', result);
  return result;
}

/**
 * Extract property-specific metrics (Walk Score, Transit Score) from subject_property.
 */
function extractPropertyMetricsFromDocling(subjectPropertySection) {
  if (!subjectPropertySection) return {};
  
  const result = {};
  
  // Collect all text and tables
  const allText = [];
  const allTables = [];
  
  if (subjectPropertySection.tables) {
    allTables.push(...subjectPropertySection.tables);
  }
  
  const pages = subjectPropertySection.pages || [];
  for (const page of pages) {
    if (page.tables) allTables.push(...page.tables);
    for (const item of (page.text_items || [])) {
      allText.push(item.text || '');
    }
  }
  
  // Look for Walk Score and Transit Score in tables
  const walkScore = findTableValue(allTables, 'Walk Score', '');
  if (walkScore) {
    const parsed = parseNumericValue(walkScore);
    if (parsed !== null) result.walk_score = parsed;
  }
  
  const transitScore = findTableValue(allTables, 'Transit Score', '');
  if (transitScore) {
    const parsed = parseNumericValue(transitScore);
    if (parsed !== null) result.transit_score = parsed;
  }
  
  // Try text patterns if not found in tables
  const combinedText = allText.join(' ');
  
  if (!result.walk_score) {
    const walkMatch = combinedText.match(/walk\s*score[:\s]+(\d+)/i);
    if (walkMatch) result.walk_score = parseInt(walkMatch[1]);
  }
  
  if (!result.transit_score) {
    const transitMatch = combinedText.match(/transit\s*score[:\s]+(\d+)/i);
    if (transitMatch) result.transit_score = parseInt(transitMatch[1]);
  }
  
  
  console.log('[Scoring] Extracted property metrics:', result);
  return result;
}

export default router;

