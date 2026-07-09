/**
 * ExtractionPipeline — local Docling -> address -> local reference lookup -> link -> score.
 *
 * Interface:
 *   run({ fileId }) -> { processingResult, sectionFiles, sections, referenceData, property }
 *
 * The pipeline intentionally has one production extraction implementation:
 * Docling full. It never reaches the internet and never falls back to a
 * different parser when Docling is unavailable.
 */

import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import { db } from '../config/database.js';
import { FileProcessor, PDF_PROCESSOR_TYPES } from './file_processor.js';
import { AddressExtractor } from './address_extractor.js';
import { PropertyService } from './property_service.js';
import { LocalReferenceData } from './local_reference_data.js';
import { SECTION_TYPES } from './costar_extract.js';
import {
  assemblePropertyData,
  getScoringService,
  ensureScoringConfigLoaded,
} from './property_data_assembler.js';
import { EXTRACTED_DIR, resolveUploadPath } from '../config/runtime_paths.js';

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function sectionTypeFromFilename(filename) {
  for (const sectionType of SECTION_TYPES) {
    if (filename.includes(`_${sectionType}.json`)) return sectionType;
  }
  return 'unknown';
}

class ExtractionPipeline {
  constructor(options = {}) {
    this.fileProcessor = options.fileProcessor || new FileProcessor(EXTRACTED_DIR);
    this.referenceData = options.referenceData || new LocalReferenceData();
    this.addressExtractor = options.addressExtractor || new AddressExtractor();
    this.propertyService = options.propertyService || new PropertyService();
    this.scoringService = options.scoringService || getScoringService();
  }

  async run({ fileId }) {
    if (!fileId) throw new Error('fileId is required');

    const fileQuery = await db.query(
      'SELECT original_filename, storage_path AS file_path, file_type FROM files WHERE id = $1',
      [fileId]
    );
    if (!fileQuery.rows[0]) {
      const error = new Error('File not found in local database');
      error.statusCode = 404;
      throw error;
    }

    const { file_path: filePathRelative, original_filename: originalFilename, file_type: fileType } = fileQuery.rows[0];
    const filePath = resolveUploadPath(filePathRelative);
    try {
      await fs.access(filePath);
    } catch {
      const error = new Error(`File not found at local path: ${filePath}`);
      error.statusCode = 404;
      throw error;
    }

    if (path.extname(originalFilename).toLowerCase() !== '.pdf') {
      const error = new Error('Local extraction currently supports PDF documents only');
      error.statusCode = 400;
      throw error;
    }

    const processingResult = await this.fileProcessor.process_file(filePath, originalFilename, {
      pdfProcessor: PDF_PROCESSOR_TYPES.DOCLING_FULL,
    });
    if (processingResult.processing_status === 'error') {
      throw new Error(processingResult.error_message || 'Docling extraction failed');
    }

    const sectionFiles = processingResult.section_files || [];
    const referenceData = await this._lookupLocalReferenceData(sectionFiles);
    const property = await this._linkAndScore(fileId, sectionFiles, referenceData, originalFilename);

    return {
      processor: PDF_PROCESSOR_TYPES.DOCLING_FULL,
      processingResult,
      sectionFiles,
      sections: processingResult.sections || [],
      referenceData,
      property,
      originalFilename,
      fileType,
    };
  }

  async _lookupLocalReferenceData(sectionFiles) {
    const subjectPropertyFile = sectionFiles.find((file) => file.includes('_subject_property.json'));
    if (!subjectPropertyFile) {
      return { available: false, reason: 'No subject_property section was produced' };
    }

    const subjectPropertyPath = path.join(EXTRACTED_DIR, path.basename(subjectPropertyFile));
    const subjectProperty = JSON.parse(await fs.readFile(subjectPropertyPath, 'utf-8'));
    const address = this.addressExtractor.extractFromSubjectProperty(subjectProperty);
    const lookup = await this.referenceData.lookup(address);
    if (!lookup.available) return { ...lookup, address };

    const baseName = path.basename(subjectPropertyFile).replace('_subject_property.json', '');
    const externalFilename = `${baseName}_external.json`;
    const externalPath = path.join(EXTRACTED_DIR, externalFilename);
    const externalData = { ...lookup.data, provenance: lookup.provenance, address };
    await fs.writeFile(externalPath, JSON.stringify(externalData, null, 2));

    return { ...lookup, address, file: externalFilename, data: externalData };
  }

  async _linkAndScore(fileId, sectionFiles, referenceData, originalFilename) {
    const subjectPropertyFile = sectionFiles.find((file) => file.includes('_subject_property.json'));
    if (!subjectPropertyFile) return null;

    const subjectPropertyPath = path.join(EXTRACTED_DIR, path.basename(subjectPropertyFile));
    const subjectProperty = JSON.parse(await fs.readFile(subjectPropertyPath, 'utf-8'));
    const address = this.addressExtractor.extractFromSubjectProperty(subjectProperty);
    const linkedFiles = referenceData?.available && referenceData.file
      ? [...sectionFiles, referenceData.file]
      : sectionFiles;

    return this._linkExtractionToProperty(fileId, linkedFiles, address, originalFilename);
  }

  async _linkExtractionToProperty(fileId, sectionFiles, address, originalFilename) {
    const property = await this.propertyService.findOrCreateByAddress(
      address,
      address.propertyName || path.basename(originalFilename, path.extname(originalFilename))
    );
    const fileQuery = await db.query(
      'SELECT original_filename, storage_path, file_type, file_size FROM files WHERE id = $1',
      [fileId]
    );
    if (!fileQuery.rows[0]) return { propertyId: property.id };

    const fileInfo = fileQuery.rows[0];
    const existingDocument = await db.query(
      'SELECT id FROM documents WHERE property_id = $1 AND storage_path = $2',
      [property.id, fileInfo.storage_path]
    );
    const documentId = existingDocument.rows[0]?.id || (
      await this.propertyService.linkDocument(property.id, {
        filename: path.basename(fileInfo.storage_path),
        originalFilename: fileInfo.original_filename,
        fileType: fileInfo.file_type,
        fileSize: fileInfo.file_size || 0,
        storagePath: fileInfo.storage_path,
      })
    ).id;

    const sections = {};
    for (const sectionFile of sectionFiles) {
      const filename = path.basename(sectionFile);
      const sectionType = sectionTypeFromFilename(filename);
      const sectionPath = path.join(EXTRACTED_DIR, filename);
      const content = await fs.readFile(sectionPath, 'utf-8');
      const existing = await db.query(
        'SELECT id FROM extracted_files WHERE property_id = $1 AND section_type = $2',
        [property.id, sectionType]
      );
      if (!existing.rows[0]) {
        await this.propertyService.linkExtractedFile(property.id, documentId, {
          sectionType,
          storagePath: path.join('extracted', filename),
          dataHash: hashContent(content),
        });
      }
      sections[sectionType] = JSON.parse(content);
    }

    await ensureScoringConfigLoaded();
    const propertyData = assemblePropertyData(sections, address);
    const scoreResult = this.scoringService.calculateScore(propertyData);
    await this.propertyService.saveScore(
      property.id,
      scoreResult,
      propertyData,
      this.scoringService.getConfig()
    );

    return { propertyId: property.id, score: scoreResult };
  }

  async checkDoclingAvailability() {
    return this.fileProcessor.checkDoclingAvailability();
  }
}

export { ExtractionPipeline, PDF_PROCESSOR_TYPES };
