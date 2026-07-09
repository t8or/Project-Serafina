/**
 * ExtractionPipeline — deep module owning Docling → address → scrape → link → score.
 *
 * Interface:
 *   run({ fileId, processor }) → {
 *     processingResult, sectionFiles, sections, externalData, property, outputPath
 *   }
 *
 * HTTP handlers validate input and map this result to a response.
 */

import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import { db } from '../config/database.js';
import { FileProcessor, PDF_PROCESSOR_TYPES } from './file_processor.js';
import { ScraperService } from './scrapers/scraper_service.js';
import { AddressExtractor } from './address_extractor.js';
import { PropertyService } from './property_service.js';
import { SECTION_TYPES } from './costar_extract.js';
import {
  assemblePropertyData,
  getScoringService,
  ensureScoringConfigLoaded,
} from './property_data_assembler.js';

const EXTRACTED_DIR = path.join(process.cwd(), 'uploads', 'extracted');

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function sectionTypeFromFilename(filename) {
  for (const st of SECTION_TYPES) {
    if (filename.includes(`_${st}.json`)) return st;
  }
  return 'unknown';
}

class ExtractionPipeline {
  constructor(options = {}) {
    this.fileProcessor = options.fileProcessor || new FileProcessor('uploads/extracted');
    this.scraperService = options.scraperService || new ScraperService({ headless: true });
    this.addressExtractor = options.addressExtractor || new AddressExtractor();
    this.propertyService = options.propertyService || new PropertyService();
    this.scoringService = options.scoringService || getScoringService();
  }

  /**
   * Run the full extraction pipeline for a stored file.
   *
   * @param {{ fileId: string|number, processor?: string }} params
   */
  async run({ fileId, processor = PDF_PROCESSOR_TYPES.DEFAULT }) {
    if (!fileId) {
      throw new Error('fileId is required');
    }
    if (!Object.values(PDF_PROCESSOR_TYPES).includes(processor)) {
      const err = new Error(
        `Invalid pdfProcessor option. Valid options: ${Object.values(PDF_PROCESSOR_TYPES).join(', ')}`
      );
      err.statusCode = 400;
      throw err;
    }

    console.log('[ExtractionPipeline] Starting', { fileId, processor });

    const fileQuery = await db.query(
      'SELECT original_filename, storage_path as file_path, file_type FROM files WHERE id = $1',
      [fileId]
    );

    if (fileQuery.rows.length === 0) {
      const err = new Error('File not found in database');
      err.statusCode = 404;
      throw err;
    }

    const { file_path, original_filename, file_type } = fileQuery.rows[0];
    const uploadDir = process.env.UPLOAD_DIR || 'uploads';
    const filePath = path.resolve(process.cwd(), uploadDir, file_path);

    try {
      await fs.access(filePath);
    } catch {
      const err = new Error(`File not found at path: ${filePath}`);
      err.statusCode = 404;
      throw err;
    }

    const processingResult = await this.fileProcessor.process_file(filePath, original_filename, {
      pdfProcessor: processor,
    });

    if (processingResult.processing_status === 'error') {
      throw new Error(processingResult.error_message || 'Processing failed');
    }

    if (processor !== PDF_PROCESSOR_TYPES.DOCLING_FULL) {
      const outputFileName = `e_${path.basename(original_filename, path.extname(original_filename))}.json`;
      return {
        processor,
        processingResult,
        sectionFiles: [],
        sections: [],
        externalData: null,
        property: null,
        outputPath: path.join(EXTRACTED_DIR, outputFileName),
        originalFilename: original_filename,
        fileType: file_type,
      };
    }

    const sectionFiles = processingResult.section_files || [];
    const externalData = await this._scrapeExternal(sectionFiles);
    const property = await this._linkAndScore(
      fileId,
      sectionFiles,
      externalData,
      original_filename
    );

    return {
      processor,
      processingResult,
      sectionFiles,
      sections: processingResult.sections || [],
      externalData,
      property,
      outputPath: null,
      originalFilename: original_filename,
      fileType: file_type,
    };
  }

  async _scrapeExternal(sectionFiles) {
    try {
      const subjectPropertyFile = sectionFiles.find((f) => f.includes('_subject_property.json'));
      if (!subjectPropertyFile) {
        console.log('[ExtractionPipeline] No subject_property section — skipping scraper');
        return { success: false, reason: 'No subject_property section' };
      }

      const subjectPropertyPath = path.join(EXTRACTED_DIR, path.basename(subjectPropertyFile));
      const subjectPropertyData = JSON.parse(await fs.readFile(subjectPropertyPath, 'utf-8'));
      const address = this.addressExtractor.extractFromSubjectProperty(subjectPropertyData);
      console.log('[ExtractionPipeline] Address for scraping:', address);

      const canScrape = address.stateAbbr && (address.city || address.zipCode);
      if (!canScrape) {
        return { success: false, reason: 'Insufficient address info', address };
      }

      const scraperResult = await this.scraperService.scrapeAllData({
        address: address.street || '',
        city: address.city || '',
        state: address.stateAbbr,
        zipCode: address.zipCode || null,
      });

      if (!scraperResult.success) {
        console.warn('[ExtractionPipeline] Scraper errors:', scraperResult.errors);
        return { success: false, errors: scraperResult.errors, address };
      }

      const baseName = path.basename(subjectPropertyFile).replace('_subject_property.json', '');
      const externalFilename = `${baseName}_external.json`;
      const externalDataPath = path.join(EXTRACTED_DIR, externalFilename);
      const externalData = {
        crime: scraperResult.crime || {},
        schools: scraperResult.schools || {},
        walkScore: scraperResult.walkScore || {},
        timestamp: new Date().toISOString(),
        address,
      };

      await fs.writeFile(externalDataPath, JSON.stringify(externalData, null, 2));
      console.log('[ExtractionPipeline] Saved external data:', externalDataPath);

      return { success: true, file: externalFilename, data: externalData, address };
    } catch (error) {
      console.error('[ExtractionPipeline] External scrape failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async _linkAndScore(fileId, sectionFiles, externalDataResult, originalFilename) {
    try {
      if (!sectionFiles.length) return null;

      const subjectPropertyFile = sectionFiles.find((f) => f.includes('_subject_property.json'));
      if (!subjectPropertyFile) return null;

      const subjectPropertyPath = path.join(EXTRACTED_DIR, path.basename(subjectPropertyFile));
      const subjectPropertyData = JSON.parse(await fs.readFile(subjectPropertyPath, 'utf-8'));
      const address = this.addressExtractor.extractFromSubjectProperty(subjectPropertyData);

      const allSectionFiles = [...sectionFiles];
      if (externalDataResult?.success && externalDataResult.file) {
        allSectionFiles.push(path.join('uploads/extracted', externalDataResult.file));
      }

      return await this._linkExtractionToProperty(
        fileId,
        allSectionFiles,
        address,
        originalFilename
      );
    } catch (error) {
      console.error('[ExtractionPipeline] Property linking error:', error.message);
      return { error: error.message };
    }
  }

  async _linkExtractionToProperty(fileId, sectionFiles, address, originalFilename) {
    try {
      console.log('[ExtractionPipeline] Linking extraction to property...');

      const property = await this.propertyService.findOrCreateByAddress(
        address,
        address.propertyName || path.basename(originalFilename, path.extname(originalFilename))
      );
      console.log(`[ExtractionPipeline] Property ID: ${property.id}`);

      const fileQuery = await db.query(
        'SELECT original_filename, storage_path, file_type, file_size FROM files WHERE id = $1',
        [fileId]
      );

      if (fileQuery.rows.length === 0) {
        return { propertyId: property.id };
      }

      const fileInfo = fileQuery.rows[0];
      const existingDoc = await db.query(
        'SELECT id FROM documents WHERE property_id = $1 AND storage_path = $2',
        [property.id, fileInfo.storage_path]
      );

      let documentId = null;
      if (existingDoc.rows.length === 0) {
        const doc = await this.propertyService.linkDocument(property.id, {
          filename: path.basename(fileInfo.storage_path),
          originalFilename: fileInfo.original_filename,
          fileType: fileInfo.file_type,
          fileSize: fileInfo.file_size || 0,
          storagePath: fileInfo.storage_path,
        });
        documentId = doc.id;
      } else {
        documentId = existingDoc.rows[0].id;
      }

      const sectionsData = {};

      for (const sectionFile of sectionFiles) {
        const sectionFilename = path.basename(sectionFile);
        const sectionPath = path.join(EXTRACTED_DIR, sectionFilename);
        const sectionType = sectionTypeFromFilename(sectionFilename);

        const existingExtracted = await db.query(
          'SELECT id FROM extracted_files WHERE property_id = $1 AND section_type = $2',
          [property.id, sectionType]
        );

        if (existingExtracted.rows.length === 0) {
          let dataHash = null;
          try {
            const content = await fs.readFile(sectionPath, 'utf-8');
            dataHash = hashContent(content);
          } catch {
            // hash optional
          }

          await this.propertyService.linkExtractedFile(property.id, documentId, {
            sectionType,
            storagePath: `extracted/${sectionFilename}`,
            dataHash,
          });
        }

        try {
          const content = await fs.readFile(sectionPath, 'utf-8');
          sectionsData[sectionType === 'unknown' ? 'combined' : sectionType] = JSON.parse(content);
        } catch (e) {
          console.warn(`[ExtractionPipeline] Could not load ${sectionFilename}: ${e.message}`);
        }
      }

      await ensureScoringConfigLoaded();
      const propertyData = assemblePropertyData(sectionsData, address);
      const scoreResult = this.scoringService.calculateScore(propertyData);
      await this.propertyService.saveScore(
        property.id,
        scoreResult,
        propertyData,
        this.scoringService.getConfig()
      );

      console.log(
        `[ExtractionPipeline] Saved score: ${scoreResult.score.toFixed(2)} (${scoreResult.decision})`
      );

      return { propertyId: property.id, score: scoreResult };
    } catch (error) {
      console.error('[ExtractionPipeline] Error linking to property:', error.message);
      return { error: error.message };
    }
  }

  /**
   * Manual scrape for an existing extraction base name (e.g. e_123-abc).
   */
  async scrapeByBaseName(baseName) {
    const subjectPropertyPath = path.join(EXTRACTED_DIR, `${baseName}_subject_property.json`);

    try {
      await fs.access(subjectPropertyPath);
    } catch {
      const err = new Error(
        `No subject_property file found for ${baseName}. Expected: ${subjectPropertyPath}`
      );
      err.statusCode = 404;
      throw err;
    }

    const subjectPropertyData = JSON.parse(await fs.readFile(subjectPropertyPath, 'utf-8'));
    const address = this.addressExtractor.extractFromSubjectProperty(subjectPropertyData);
    const canScrape = address.stateAbbr && (address.city || address.zipCode);

    if (!canScrape) {
      const err = new Error('Insufficient address info for scraping');
      err.statusCode = 400;
      err.address = address;
      throw err;
    }

    const scraperResult = await this.scraperService.scrapeAllData({
      address: address.street || '',
      city: address.city || '',
      state: address.stateAbbr,
      zipCode: address.zipCode || null,
    });

    if (
      !(
        scraperResult.success ||
        scraperResult.crime ||
        scraperResult.schools ||
        scraperResult.walkScore
      )
    ) {
      const err = new Error('All scrapers failed');
      err.statusCode = 500;
      err.errors = scraperResult.errors;
      throw err;
    }

    const externalData = {
      crime: scraperResult.crime || {},
      schools: scraperResult.schools || {},
      walkScore: scraperResult.walkScore || {},
      timestamp: new Date().toISOString(),
      address,
    };

    const externalDataPath = path.join(EXTRACTED_DIR, `${baseName}_external.json`);
    await fs.writeFile(externalDataPath, JSON.stringify(externalData, null, 2));

    return {
      success: true,
      outputFile: `${baseName}_external.json`,
      data: externalData,
      errors: scraperResult.errors || [],
    };
  }

  async checkDoclingAvailability() {
    return this.fileProcessor.checkDoclingAvailability();
  }
}

export { ExtractionPipeline, PDF_PROCESSOR_TYPES };
