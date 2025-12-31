#!/usr/bin/env node

/**
 * Backfill Script: Migrate Existing Data to Property-Centric Schema
 * 
 * This script:
 * 1. Reads existing extracted files from uploads/extracted/
 * 2. Groups them by property (based on filename prefix)
 * 3. Creates property records with addresses extracted from subject_property sections
 * 4. Links extracted files to properties
 * 5. Calculates and persists scores
 * 
 * Run: node scripts/backfill_properties.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';

// Import services
import { db, initDb } from '../src/config/database.js';
import { PropertyService } from '../src/services/property_service.js';
import { AddressExtractor } from '../src/services/address_extractor.js';
import { ScoringService } from '../src/services/scoring_service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Directory paths
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const EXTRACTED_DIR = path.join(UPLOADS_DIR, 'extracted');
const DOCUMENTS_DIR = path.join(UPLOADS_DIR, 'documents');

// Section types to look for
const SECTION_TYPES = [
  'subject_property', 'demographics', 'rent_comps', 'construction',
  'sale_comps', 'submarket_report', 'market_report', 'unknown', 'external'
];

// Services
const propertyService = new PropertyService();
const addressExtractor = new AddressExtractor();
const scoringService = new ScoringService();

/**
 * Calculate SHA-256 hash of file content.
 */
function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Group extracted files by property base name.
 * e.g., "e_1767155556269-bdo8hs_demographics.json" -> "e_1767155556269-bdo8hs"
 */
async function groupExtractedFiles() {
  console.log('\n📂 Reading extracted files...');
  
  let files;
  try {
    files = await fs.readdir(EXTRACTED_DIR);
  } catch (error) {
    console.log('No extracted directory found, nothing to backfill.');
    return new Map();
  }

  const jsonFiles = files.filter(f => f.endsWith('.json'));
  console.log(`Found ${jsonFiles.length} JSON files`);

  const propertyGroups = new Map();

  for (const file of jsonFiles) {
    // Determine base name (everything before _section.json)
    let baseName = file;
    let sectionType = null;

    for (const section of SECTION_TYPES) {
      if (file.includes(`_${section}.json`)) {
        baseName = file.replace(`_${section}.json`, '');
        sectionType = section;
        break;
      }
    }

    // If no section type found, it's a standalone file
    if (!sectionType) {
      baseName = file.replace('.json', '');
      sectionType = 'combined';
    }

    if (!propertyGroups.has(baseName)) {
      propertyGroups.set(baseName, { files: [], sections: {} });
    }

    propertyGroups.get(baseName).files.push(file);
    propertyGroups.get(baseName).sections[sectionType] = file;
  }

  console.log(`Grouped into ${propertyGroups.size} properties`);
  return propertyGroups;
}

/**
 * Try to find the source document for an extracted property.
 */
async function findSourceDocument(baseName) {
  // Extract the file ID from base name (e.g., "e_1767155556269-bdo8hs" -> "1767155556269-bdo8hs")
  const fileId = baseName.replace(/^e_/, '');
  
  try {
    const docFiles = await fs.readdir(DOCUMENTS_DIR);
    
    // Look for a document with matching ID
    for (const doc of docFiles) {
      if (doc.includes(fileId)) {
        const stats = await fs.stat(path.join(DOCUMENTS_DIR, doc));
        return {
          filename: doc,
          storagePath: `documents/${doc}`,
          fileSize: stats.size,
          fileType: path.extname(doc).slice(1) || 'pdf'
        };
      }
    }
  } catch (error) {
    // Documents directory doesn't exist or error reading
  }

  return null;
}

/**
 * Load and parse a JSON file.
 */
async function loadJsonFile(filename) {
  const filePath = path.join(EXTRACTED_DIR, filename);
  const content = await fs.readFile(filePath, 'utf-8');
  return { data: JSON.parse(content), content, hash: hashContent(content) };
}

/**
 * Build property data for scoring from extracted sections.
 */
function buildPropertyDataForScoring(sections, address) {
  // Extract demographics data
  const demographicsData = {};
  const submarket = sections.demographics || sections.submarket_report;
  
  if (submarket?.tables) {
    // Try to extract from tables (simplified - full logic is in scoringHandler)
    for (const table of submarket.tables) {
      if (table.rows) {
        for (const row of table.rows) {
          const threeValue = row['3 Mile'];
          if (threeValue) {
            const label = String(Object.values(row)[0] || '').toLowerCase();
            if (label.includes('population') && !label.includes('growth')) {
              demographicsData.population_3mile = parseFloat(String(threeValue).replace(/[,$]/g, ''));
            }
            if (label.includes('growth')) {
              demographicsData.population_growth_3mile = parseFloat(String(threeValue).replace('%', '')) / 100;
            }
            if (label.includes('median household income') || label.includes('median hh income')) {
              demographicsData.median_hh_income_3mile = parseFloat(String(threeValue).replace(/[$,]/g, ''));
            }
            if (label.includes('median home value')) {
              demographicsData.median_home_value_3mile = parseFloat(String(threeValue).replace(/[$,]/g, ''));
            }
            if (label.includes('renter')) {
              demographicsData.renter_households_pct_3mile = parseFloat(String(threeValue).replace('%', '')) / 100;
            }
          }
        }
      }
    }
  }

  // External data (crime, schools, walk score)
  const externalData = sections.external || { crime: {}, schools: {}, walkScore: {} };

  return {
    address,
    demographics: demographicsData,
    property: {},
    submarket: {},
    external: externalData
  };
}

/**
 * Process a single property group.
 */
async function processPropertyGroup(baseName, group) {
  console.log(`\n🏠 Processing: ${baseName}`);

  try {
    // Load all section files
    const loadedSections = {};
    for (const [sectionType, filename] of Object.entries(group.sections)) {
      try {
        const { data, content, hash } = await loadJsonFile(filename);
        loadedSections[sectionType] = { data, filename, hash };
      } catch (error) {
        console.log(`  ⚠️  Could not load ${filename}: ${error.message}`);
      }
    }

    // Skip if only external data (no actual property info)
    const hasPropertyData = loadedSections.subject_property || loadedSections.demographics || 
                            loadedSections.construction || loadedSections.combined;
    if (!hasPropertyData) {
      console.log('  ⏭️  Skipping - only has external data');
      return null;
    }

    // Extract address from subject_property or combined
    const subjectData = loadedSections.subject_property?.data || loadedSections.combined?.data;
    const address = addressExtractor.extractFromSubjectProperty(subjectData);
    
    console.log(`  📍 Address: ${address.fullAddress || 'Not found'}`);
    console.log(`  🏷️  Name: ${address.propertyName || baseName.replace('e_', '')}`);

    // Find or create property
    const property = await propertyService.findOrCreateByAddress(
      address, 
      address.propertyName || baseName.replace('e_', '')
    );
    console.log(`  ✅ Property ID: ${property.id}`);

    // Try to find and link source document
    const sourceDoc = await findSourceDocument(baseName);
    let documentId = null;
    
    if (sourceDoc) {
      // Check if document already linked
      const existingDoc = await db.query(
        `SELECT id FROM documents WHERE property_id = $1 AND filename = $2`,
        [property.id, sourceDoc.filename]
      );
      
      if (existingDoc.rows.length === 0) {
        const doc = await propertyService.linkDocument(property.id, {
          filename: sourceDoc.filename,
          originalFilename: sourceDoc.filename,
          fileType: sourceDoc.fileType,
          fileSize: sourceDoc.fileSize,
          storagePath: sourceDoc.storagePath
        });
        documentId = doc.id;
        console.log(`  📎 Linked document: ${sourceDoc.filename}`);
      } else {
        documentId = existingDoc.rows[0].id;
      }
    }

    // Link extracted files
    for (const [sectionType, { filename, hash }] of Object.entries(loadedSections)) {
      // Check if already linked
      const existing = await db.query(
        `SELECT id FROM extracted_files WHERE property_id = $1 AND section_type = $2`,
        [property.id, sectionType]
      );
      
      if (existing.rows.length === 0) {
        await propertyService.linkExtractedFile(property.id, documentId, {
          sectionType,
          storagePath: `extracted/${filename}`,
          dataHash: hash
        });
      }
    }
    console.log(`  📁 Linked ${Object.keys(loadedSections).length} extracted files`);

    // Build property data and calculate score
    const sectionsData = {};
    for (const [key, val] of Object.entries(loadedSections)) {
      sectionsData[key] = val.data;
    }
    
    const propertyData = buildPropertyDataForScoring(sectionsData, address);
    const scoreResult = scoringService.calculateScore(propertyData);
    
    // Save score
    await propertyService.saveScore(
      property.id,
      scoreResult,
      propertyData,
      scoringService.getConfig()
    );
    console.log(`  📊 Score: ${scoreResult.score.toFixed(2)} (${scoreResult.decision})`);

    return property;

  } catch (error) {
    console.error(`  ❌ Error processing ${baseName}:`, error.message);
    return null;
  }
}

/**
 * Main backfill function.
 */
async function backfill() {
  console.log('🚀 Starting property backfill...\n');
  console.log('=' .repeat(60));

  // Initialize database
  console.log('Initializing database...');
  await initDb();

  // Group extracted files
  const propertyGroups = await groupExtractedFiles();
  
  if (propertyGroups.size === 0) {
    console.log('\nNo properties to backfill.');
    return;
  }

  // Process each property group
  let processed = 0;
  let errors = 0;

  for (const [baseName, group] of propertyGroups) {
    const result = await processPropertyGroup(baseName, group);
    if (result) {
      processed++;
    } else {
      errors++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📈 Backfill Summary:');
  console.log(`   Total property groups: ${propertyGroups.size}`);
  console.log(`   Successfully processed: ${processed}`);
  console.log(`   Skipped/Errors: ${errors}`);

  // Get final stats
  const stats = await propertyService.getSummaryStats();
  console.log('\n📊 Database Stats:');
  console.log(`   Total properties: ${stats.count}`);
  console.log(`   Move Forward: ${stats.moveForward}`);
  console.log(`   Needs Review: ${stats.needsReview}`);
  console.log(`   Rejected: ${stats.rejected}`);
  console.log(`   Average Score: ${stats.averageScore.toFixed(2)}`);

  console.log('\n✅ Backfill complete!');
}

// Run backfill
backfill()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

