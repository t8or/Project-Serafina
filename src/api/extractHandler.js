import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { FileProcessor, PDF_PROCESSOR_TYPES } from '../services/file_processor.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { db } from '../config/database.js';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import { ScraperService } from '../services/scrapers/scraper_service.js';
import { AddressExtractor } from '../services/address_extractor.js';
import { PropertyService } from '../services/property_service.js';
import { ScoringService } from '../services/scoring_service.js';
import { 
  extractDemographicsFromDocling, 
  extractSubmarketFromDocling 
} from './scoringHandler.js';

// Force reload environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();
const processor = new FileProcessor('uploads/extracted');
const scraperService = new ScraperService({ headless: true });
const addressExtractor = new AddressExtractor();
const propertyService = new PropertyService();
const scoringService = new ScoringService();

/**
 * Calculate SHA-256 hash of content for change detection.
 */
function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Link extraction results to a property and calculate score.
 * This is called after successful extraction to persist data to the property-centric schema.
 */
async function linkExtractionToProperty(fileId, sectionFiles, address, originalFilename) {
  try {
    console.log('[Extract] Linking extraction to property...');
    
    // Find or create property by address
    const property = await propertyService.findOrCreateByAddress(
      address,
      address.propertyName || path.basename(originalFilename, path.extname(originalFilename))
    );
    console.log(`[Extract] Property ID: ${property.id}`);

    // Get original document info and link it
    const fileQuery = await db.query(
      'SELECT original_filename, storage_path, file_type, file_size FROM files WHERE id = $1',
      [fileId]
    );
    
    if (fileQuery.rows.length > 0) {
      const fileInfo = fileQuery.rows[0];
      
      // Check if document already linked
      const existingDoc = await db.query(
        'SELECT id FROM documents WHERE property_id = $1 AND storage_path = $2',
        [property.id, fileInfo.storage_path]
      );
      
      let documentId = null;
      if (existingDoc.rows.length === 0) {
        const doc = await propertyService.linkDocument(property.id, {
          filename: path.basename(fileInfo.storage_path),
          originalFilename: fileInfo.original_filename,
          fileType: fileInfo.file_type,
          fileSize: fileInfo.file_size || 0,
          storagePath: fileInfo.storage_path
        });
        documentId = doc.id;
        console.log(`[Extract] Linked document ${documentId} to property`);
      } else {
        documentId = existingDoc.rows[0].id;
      }

      // Link each section file to the property
      for (const sectionFile of sectionFiles) {
        const sectionFilename = path.basename(sectionFile);
        const sectionPath = path.join(process.cwd(), 'uploads/extracted', sectionFilename);
        
        // Determine section type from filename
        let sectionType = 'unknown';
        const sectionTypes = ['subject_property', 'demographics', 'rent_comps', 'construction',
                             'sale_comps', 'submarket_report', 'market_report', 'external', 'unknown'];
        for (const st of sectionTypes) {
          if (sectionFilename.includes(`_${st}.json`)) {
            sectionType = st;
            break;
          }
        }

        // Check if already linked
        const existingExtracted = await db.query(
          'SELECT id FROM extracted_files WHERE property_id = $1 AND section_type = $2',
          [property.id, sectionType]
        );

        if (existingExtracted.rows.length === 0) {
          // Calculate hash for change detection
          let dataHash = null;
          try {
            const content = await fs.readFile(sectionPath, 'utf-8');
            dataHash = hashContent(content);
          } catch (e) {
            // Ignore hash errors
          }

          await propertyService.linkExtractedFile(property.id, documentId, {
            sectionType,
            storagePath: `extracted/${sectionFilename}`,
            dataHash
          });
        }
      }
      console.log(`[Extract] Linked ${sectionFiles.length} extracted files`);

      // Load section data and calculate score (v2 - with demographics extraction)
      const sectionsData = {};
      for (const sectionFile of sectionFiles) {
        const sectionFilename = path.basename(sectionFile);
        const sectionPath = path.join(process.cwd(), 'uploads/extracted', sectionFilename);
        
        let sectionType = 'combined';
        const sectionTypes = ['subject_property', 'demographics', 'rent_comps', 'construction',
                             'sale_comps', 'submarket_report', 'market_report', 'external', 'unknown'];
        for (const st of sectionTypes) {
          if (sectionFilename.includes(`_${st}.json`)) {
            sectionType = st;
            break;
          }
        }

        try {
          const content = await fs.readFile(sectionPath, 'utf-8');
          sectionsData[sectionType] = JSON.parse(content);
        } catch (e) {
          console.warn(`[Extract] Could not load ${sectionFilename}: ${e.message}`);
        }
      }

      // Extract demographics and submarket data from Docling sections
      console.log('[Extract] Calling extraction functions...');
      console.log('[Extract] Available sections:', Object.keys(sectionsData));
      
      let demographicsData = {};
      let submarketData = {};
      
      try {
        demographicsData = extractDemographicsFromDocling(
          sectionsData.demographics, 
          sectionsData.submarket_report
        ) || {};
        console.log('[Extract] Extracted demographics:', JSON.stringify(demographicsData));
      } catch (e) {
        console.error('[Extract] Demographics extraction error:', e.message);
      }
      
      try {
        submarketData = extractSubmarketFromDocling(
          sectionsData.submarket_report, 
          sectionsData.construction, 
          sectionsData.demographics
        ) || {};
        console.log('[Extract] Extracted submarket:', JSON.stringify(submarketData));
      } catch (e) {
        console.error('[Extract] Submarket extraction error:', e.message);
      }

      // Build property data for scoring
      const propertyData = {
        address,
        demographics: demographicsData,
        property: {},
        submarket: submarketData,
        external: sectionsData.external || {}
      };

      // Calculate and save score
      const scoreResult = scoringService.calculateScore(propertyData);
      await propertyService.saveScore(
        property.id,
        scoreResult,
        propertyData,
        scoringService.getConfig()
      );
      console.log(`[Extract] Saved score: ${scoreResult.score.toFixed(2)} (${scoreResult.decision})`);

      return { propertyId: property.id, score: scoreResult };
    }

    return { propertyId: property.id };
  } catch (error) {
    console.error('[Extract] Error linking to property:', error.message);
    // Don't fail the extraction if property linking fails
    return { error: error.message };
  }
}

/**
 * Valid PDF processor options:
 * - 'default': Pattern-based extraction + Ollama LLM analysis (existing behavior)
 * - 'docling': Docling ML-based document understanding (quick, first 7 pages)
 * - 'docling_full': Docling full processing with section detection (all pages, separate files per section)
 */
const VALID_PDF_PROCESSORS = Object.values(PDF_PROCESSOR_TYPES);

// Add logging middleware
router.use((req, res, next) => {
  console.log('\n=== Extract Handler Request ===');
  console.log('Environment State:', {
    DB_USER: process.env.DB_USER,
    DB_HOST: process.env.DB_HOST,
    DB_NAME: process.env.DB_NAME,
    NODE_ENV: process.env.NODE_ENV,
    CWD: process.cwd()
  });
  console.log('Pool Config:', db.options);
  next();
});

/**
 * Extract text and data from a file.
 * 
 * POST /extract/:fileId
 * 
 * Query Parameters:
 * - pdfProcessor: (optional) PDF processor to use: 'default', 'docling', or 'docling_full'
 *   - 'default': Pattern-based extraction + Ollama LLM analysis
 *   - 'docling': Docling ML-based document understanding with TableFormer (quick, first 7 pages)
 *   - 'docling_full': Docling full processing - all pages with CoStar section detection
 *     (outputs separate JSON files per section: subject_property, rent_comps, construction, etc.)
 * 
 * Body Parameters (optional):
 * - pdfProcessor: Same as query parameter (body takes precedence)
 */
router.post('/extract/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    
    // Get PDF processor option from query or body
    const pdfProcessor = req.body?.pdfProcessor || req.query?.pdfProcessor || PDF_PROCESSOR_TYPES.DEFAULT;
    
    // Validate processor option
    if (!VALID_PDF_PROCESSORS.includes(pdfProcessor)) {
      console.log('[DEBUG-H9] Validation failed! Returning 400');
      return res.status(400).json({
        success: false,
        error: `Invalid pdfProcessor option. Valid options: ${VALID_PDF_PROCESSORS.join(', ')}`
      });
    }
    
    console.log('\n=== Starting Extraction Process ===');
    console.log('Processing file ID:', fileId);
    console.log('PDF Processor:', pdfProcessor);
    console.log('Current pool state:', {
      totalCount: db.totalCount,
      idleCount: db.idleCount,
      waitingCount: db.waitingCount
    });

    // Get the file details from the database
    console.log('Attempting database query...');
    const fileQuery = await db.query(
      'SELECT original_filename, storage_path as file_path, file_type FROM files WHERE id = $1',
      [fileId]
    );
    console.log('Database query completed');

    if (fileQuery.rows.length === 0) {
      console.error('File not found in database');
      throw new Error('File not found in database');
    }

    const { file_path, original_filename, file_type } = fileQuery.rows[0];
    console.log('File details from DB:', { file_path, original_filename, file_type });
    
    // Get the absolute file path using UPLOAD_DIR
    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    const filePath = path.resolve(process.cwd(), uploadDir, file_path);
    console.log('Resolved file path:', filePath);

    // Check if file exists
    try {
      await fs.access(filePath);
      console.log('File exists at path:', filePath);
    } catch (error) {
      console.error('File does not exist at path:', filePath);
      throw new Error(`File not found at path: ${filePath}`);
    }
    
    // Process the file with selected processor
    console.log('Starting file processing...', { filePath, file_type, pdfProcessor });
    const result = await processor.process_file(filePath, original_filename, { pdfProcessor });
    console.log('Processing result:', result);

    if (result.processing_status === 'error') {
      console.error('Processing error:', result.error_message);
      throw new Error(result.error_message);
    }

    // Handle response based on processor type
    if (pdfProcessor === PDF_PROCESSOR_TYPES.DOCLING_FULL) {
      // Full processor outputs multiple section files
      const sectionFiles = result.section_files || [];
      
      // After docling_full extraction, run external data scraping
      let externalDataResult = null;
      try {
        // Find subject_property section file to extract address
        const subjectPropertyFile = sectionFiles.find(f => f.includes('_subject_property.json'));
        
        if (subjectPropertyFile) {
          const subjectPropertyPath = path.join(process.cwd(), 'uploads/extracted', path.basename(subjectPropertyFile));
          const subjectPropertyData = JSON.parse(await fs.readFile(subjectPropertyPath, 'utf-8'));
          
          // Extract address from the subject property section
          const address = addressExtractor.extractFromSubjectProperty(subjectPropertyData);
          console.log('[Extract] Extracted address for scraping:', address);
          
          // Only scrape if we have enough address info
          const canScrape = address.stateAbbr && (address.city || address.zipCode);
          
          if (canScrape) {
            console.log(`[Extract] Starting external data scrape for ${address.street}, ${address.city}, ${address.stateAbbr}`);
            
            const scraperResult = await scraperService.scrapeAllData({
              address: address.street || '',
              city: address.city || '',
              state: address.stateAbbr,
              zipCode: address.zipCode || null,
            });
            
            
            if (scraperResult.success) {
              // Save external data alongside the section files
              const baseName = path.basename(subjectPropertyFile).replace('_subject_property.json', '');
              const externalDataPath = path.join(process.cwd(), 'uploads/extracted', `${baseName}_external.json`);
              
              const externalData = {
                crime: scraperResult.crime || {},
                schools: scraperResult.schools || {},
                walkScore: scraperResult.walkScore || {},
                timestamp: new Date().toISOString(),
                address: address,
              };
              
              await fs.writeFile(externalDataPath, JSON.stringify(externalData, null, 2));
              console.log(`[Extract] Saved external data to ${externalDataPath}`);
              externalDataResult = { success: true, file: `${baseName}_external.json` };
            } else {
              console.warn('[Extract] Scraper had errors:', scraperResult.errors);
              externalDataResult = { success: false, errors: scraperResult.errors };
            }
          } else {
            console.log('[Extract] Skipping scraper - insufficient address info');
            externalDataResult = { success: false, reason: 'Insufficient address info' };
          }
        } else {
          console.log('[Extract] No subject_property section found - skipping scraper');
          externalDataResult = { success: false, reason: 'No subject_property section' };
        }
      } catch (scraperError) {
        console.error('[Extract] External data scraping failed:', scraperError.message);
        externalDataResult = { success: false, error: scraperError.message };
      }
      
      // Link extraction to property-centric schema
      let propertyLinkResult = null;
      if (sectionFiles.length > 0) {
        // Find subject_property section to get address
        const subjectPropertyFile = sectionFiles.find(f => f.includes('_subject_property.json'));
        if (subjectPropertyFile) {
          const subjectPropertyPath = path.join(process.cwd(), 'uploads/extracted', path.basename(subjectPropertyFile));
          try {
            const subjectPropertyData = JSON.parse(await fs.readFile(subjectPropertyPath, 'utf-8'));
            const extractedAddress = addressExtractor.extractFromSubjectProperty(subjectPropertyData);
            
            // Include external data file in section files
            const allSectionFiles = [...sectionFiles];
            if (externalDataResult?.success && externalDataResult.file) {
              allSectionFiles.push(`uploads/extracted/${externalDataResult.file}`);
            }
            
            propertyLinkResult = await linkExtractionToProperty(
              fileId,
              allSectionFiles,
              extractedAddress,
              original_filename
            );
          } catch (linkError) {
            console.error('[Extract] Property linking error:', linkError.message);
            propertyLinkResult = { error: linkError.message };
          }
        }
      }

      res.json({
        success: true,
        message: `Text extracted successfully. Generated ${sectionFiles.length} section files.`,
        sectionFiles: sectionFiles,
        sections: result.sections || [],
        processorUsed: pdfProcessor,
        externalData: externalDataResult,
        property: propertyLinkResult,
        result: result
      });
    } else {
      // Standard single-file output
      const outputFileName = `e_${path.basename(original_filename, path.extname(original_filename))}.json`;
      const outputPath = path.join(process.cwd(), 'uploads/extracted', outputFileName);
      
      res.json({
        success: true,
        message: 'Text extracted successfully',
        outputPath: outputPath,
        processorUsed: pdfProcessor,
        result: result
      });
    }

  } catch (error) {
    console.error('\n=== Extraction Error ===');
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Manually trigger external data scraping for an existing extraction.
 * 
 * POST /api/extract/scrape/:baseName
 * 
 * This endpoint allows you to run the crime, schools, and walkscore scrapers
 * for a property that was extracted without scraping (or to refresh the data).
 */
router.post('/extract/scrape/:baseName', async (req, res) => {
  try {
    const { baseName } = req.params;
    const extractedDir = path.join(process.cwd(), 'uploads/extracted');
    
    // Find the subject_property file
    const subjectPropertyPath = path.join(extractedDir, `${baseName}_subject_property.json`);
    
    try {
      await fs.access(subjectPropertyPath);
    } catch {
      return res.status(404).json({
        success: false,
        error: `No subject_property file found for ${baseName}. Expected: ${subjectPropertyPath}`
      });
    }
    
    // Load subject property and extract address
    const subjectPropertyData = JSON.parse(await fs.readFile(subjectPropertyPath, 'utf-8'));
    const address = addressExtractor.extractFromSubjectProperty(subjectPropertyData);
    
    console.log('[Extract] Manual scrape - extracted address:', address);
    
    // Check if we have enough address info
    const canScrape = address.stateAbbr && (address.city || address.zipCode);
    if (!canScrape) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient address info for scraping',
        address
      });
    }
    
    console.log(`[Extract] Manual scrape starting for ${address.street}, ${address.city}, ${address.stateAbbr}`);
    
    const scraperResult = await scraperService.scrapeAllData({
      address: address.street || '',
      city: address.city || '',
      state: address.stateAbbr,
      zipCode: address.zipCode || null,
    });
    
    console.log('[Extract] Manual scrape result:', {
      success: scraperResult.success,
      hasCrime: !!scraperResult.crime,
      hasSchools: !!scraperResult.schools,
      hasWalkScore: !!scraperResult.walkScore,
      errors: scraperResult.errors
    });
    
    if (scraperResult.success || scraperResult.crime || scraperResult.schools || scraperResult.walkScore) {
      // Save external data
      const externalDataPath = path.join(extractedDir, `${baseName}_external.json`);
      
      const externalData = {
        crime: scraperResult.crime || {},
        schools: scraperResult.schools || {},
        walkScore: scraperResult.walkScore || {},
        timestamp: new Date().toISOString(),
        address: address,
      };
      
      await fs.writeFile(externalDataPath, JSON.stringify(externalData, null, 2));
      console.log(`[Extract] Manual scrape - saved external data to ${externalDataPath}`);
      
      res.json({
        success: true,
        message: 'External data scraped and saved',
        outputFile: `${baseName}_external.json`,
        data: externalData,
        errors: scraperResult.errors || []
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'All scrapers failed',
        errors: scraperResult.errors
      });
    }
    
  } catch (error) {
    console.error('[Extract] Manual scrape error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Check Docling processor availability.
 * 
 * GET /extract/docling/status
 */
router.get('/docling/status', async (req, res) => {
  try {
    const status = await processor.checkDoclingAvailability();
    res.json({
      success: true,
      docling: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router; 