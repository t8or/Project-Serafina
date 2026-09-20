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
import { PropertyService, buildNormalizedAddress } from './property_service.js';
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
    const property = await this._linkAndScore(fileId, sectionFiles, referenceData, originalFilename, processingResult);

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

  async _linkAndScore(fileId, sectionFiles, referenceData, originalFilename, processingResult) {
    const subjectPropertyFile = sectionFiles.find((file) => file.includes('_subject_property.json'));
    if (!subjectPropertyFile) {
      await this._publishRevision(fileId, null, processingResult);
      return null;
    }

    const subjectPropertyPath = path.join(EXTRACTED_DIR, path.basename(subjectPropertyFile));
    const subjectProperty = JSON.parse(await fs.readFile(subjectPropertyPath, 'utf-8'));
    const address = this.addressExtractor.extractFromSubjectProperty(subjectProperty);
    const linkedFiles = referenceData?.available && referenceData.file
      ? [...sectionFiles, referenceData.file]
      : sectionFiles;

    return this._linkExtractionToProperty(fileId, linkedFiles, address, originalFilename, processingResult);
  }

  async _publishRevision(fileId, propertyId, result, client = db) {
    if (!result?.evidence_file) return null;
    const evidencePath = path.join('extracted', path.basename(result.evidence_file));
    return client.query(`INSERT INTO report_revisions (file_id, property_id, source_sha256, evidence_path, coverage_json)
      VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [fileId, propertyId, result.metadata.source_sha256, evidencePath, result.coverage]);
  }

  async _linkExtractionToProperty(fileId, sectionFiles, address, originalFilename, processingResult) {
    const fileInfo = (await db.query('SELECT * FROM files WHERE id = $1', [fileId])).rows[0];
    const sections = {}, records = [];
    for (const sectionFile of sectionFiles) {
      const filename = path.basename(sectionFile);
      const sectionType = sectionTypeFromFilename(filename);
      const content = await fs.readFile(path.join(EXTRACTED_DIR, filename), 'utf-8');
      sections[sectionType] = JSON.parse(content);
      records.push({ filename, sectionType, hash: hashContent(content) });
    }
    await ensureScoringConfigLoaded();
    const propertyData = assemblePropertyData(sections, address);
    const score = this.scoringService.calculateScore(propertyData);
    // Incomplete structural reading cannot publish a business decision.
    if (processingResult?.coverage?.status !== 'complete') {
      score.score = null; score.eligible = false;
      score.decision = 'Insufficient data'; score.decisionColor = 'gray';
      score.coverage = processingResult?.coverage;
    }
    return db.transaction((client) => {
      const normalized = address.street && address.city && (address.stateAbbr || address.state)
        ? buildNormalizedAddress(address) : null;
      let property = normalized ? client.query(
        'SELECT * FROM properties WHERE address_normalized = $1 AND deleted_at IS NULL', [normalized]
      ).rows[0] : null;
      if (!property) {
        // Retries of a document without a usable address still have a stable identity.
        property = client.query(`SELECT p.* FROM properties p JOIN documents d ON d.property_id = p.id
          WHERE d.storage_path = $1 AND p.deleted_at IS NULL`, [fileInfo.storage_path]).rows[0];
      }
      if (!property) property = client.query(`INSERT INTO properties
        (name, address_street, address_city, address_state, address_state_abbr, address_zip, address_full, address_normalized)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [address.propertyName || path.parse(originalFilename).name, address.street, address.city,
         address.state, address.stateAbbr, address.zipCode, address.fullAddress, normalized]).rows[0];
      // Refresh identity from the same Report that supplies the current projections.
      client.query(`UPDATE properties SET name=$1, address_street=$2, address_city=$3, address_state=$4,
        address_state_abbr=$5, address_zip=$6, address_full=$7, address_normalized=$8 WHERE id=$9`,
        [address.propertyName || property.name, address.street, address.city, address.state, address.stateAbbr,
         address.zipCode, address.fullAddress, normalized, property.id]);
      let document = client.query('SELECT * FROM documents WHERE property_id = $1 AND storage_path = $2 AND deleted_at IS NULL',
        [property.id, fileInfo.storage_path]).rows[0];
      if (!document) document = client.query(`INSERT INTO documents
        (property_id, filename, original_filename, file_type, file_size, storage_path)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [property.id, fileInfo.filename, fileInfo.original_filename,
          fileInfo.file_type, fileInfo.file_size, fileInfo.storage_path]).rows[0];
      // Old revisions remain retained; only current section references change together.
      client.query('UPDATE extracted_files SET deleted_at = CURRENT_TIMESTAMP, superseded = 1 WHERE property_id = $1 AND deleted_at IS NULL', [property.id]);
      for (const record of records) client.query(`INSERT INTO extracted_files
        (property_id, document_id, section_type, storage_path, data_hash) VALUES ($1,$2,$3,$4,$5)`,
        [property.id, document.id, record.sectionType, path.join('extracted', record.filename), record.hash]);
      let revision = null;
      if (processingResult?.evidence_file) revision = client.query(`INSERT INTO report_revisions
        (file_id, property_id, source_sha256, evidence_path, coverage_json, projection_json) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [fileId, property.id, processingResult.metadata.source_sha256,
         path.join('extracted', path.basename(processingResult.evidence_file)), processingResult.coverage, propertyData]).rows[0];
      propertyData.reportRevisionId = revision?.id;
      propertyData.coverage = processingResult?.coverage;
      client.query(`INSERT INTO scores (property_id, score, decision, decision_color, breakdown, raw_data, config_snapshot)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(property_id) DO UPDATE SET score=excluded.score,
        decision=excluded.decision, decision_color=excluded.decision_color, breakdown=excluded.breakdown,
        raw_data=excluded.raw_data, config_snapshot=excluded.config_snapshot, calculated_at=CURRENT_TIMESTAMP`,
        [property.id, score.score, score.decision, score.decisionColor, score.breakdown, propertyData, this.scoringService.getConfig()]);
      client.query('UPDATE files SET is_extracted = 1 WHERE id = $1', [fileId]);
      return { propertyId: property.id, revisionId: revision?.id, score };
    });
  }

  async checkDoclingAvailability() {
    return this.fileProcessor.checkDoclingAvailability();
  }
}

export { ExtractionPipeline, PDF_PROCESSOR_TYPES };
