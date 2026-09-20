/**
 * Property Service
 * 
 * Manages the property-centric data model with CRUD operations,
 * address-based property matching, soft delete, and cascade operations.
 */

import { db } from '../config/database.js';
import fs from 'fs/promises';
import path from 'node:path';
import { UPLOADS_DIR, EXTRACTED_DIR, resolveUploadPath } from '../config/runtime_paths.js';

/**
 * Normalize an address string for consistent matching.
 * Removes punctuation, extra spaces, and converts to lowercase.
 * 
 * @param {string} address - Address string to normalize
 * @returns {string} Normalized address
 */
function normalizeAddress(address) {
  if (!address) return '';
  return address
    .toLowerCase()
    .replace(/[.,#-]/g, ' ')      // Replace punctuation with spaces
    .replace(/\s+/g, ' ')         // Collapse multiple spaces
    .replace(/\b(street|st)\b/gi, 'st')
    .replace(/\b(avenue|ave)\b/gi, 'ave')
    .replace(/\b(boulevard|blvd)\b/gi, 'blvd')
    .replace(/\b(drive|dr)\b/gi, 'dr')
    .replace(/\b(road|rd)\b/gi, 'rd')
    .replace(/\b(lane|ln)\b/gi, 'ln')
    .replace(/\b(court|ct)\b/gi, 'ct')
    .replace(/\b(place|pl)\b/gi, 'pl')
    .replace(/\b(apartment|apt)\b/gi, 'apt')
    .replace(/\b(suite|ste)\b/gi, 'ste')
    .trim();
}

/**
 * Build a normalized address string from components.
 * Used for property matching.
 * 
 * @param {Object} address - Address object with street, city, state, zip
 * @returns {string} Normalized address string
 */
function buildNormalizedAddress(address) {
  if (!address) return '';
  
  const parts = [];
  if (address.street) parts.push(address.street);
  if (address.city) parts.push(address.city);
  if (address.stateAbbr || address.state) parts.push(address.stateAbbr || address.state);
  
  return normalizeAddress(parts.join(' '));
}

class PropertyService {
  constructor() {
    this.uploadsDir = UPLOADS_DIR;
  }

  /**
   * Find an existing property by normalized address or create a new one.
   * This is the primary method for ensuring properties are deduplicated by address.
   * 
   * @param {Object} address - Address object from extraction
   * @param {string} propertyName - Optional property name
   * @returns {Promise<Object>} The found or created property
   */
  async findOrCreateByAddress(address, propertyName = null) {
    const normalizedAddr = buildNormalizedAddress(address);
    
    if (!normalizedAddr || !address?.street || !address?.city || !(address?.stateAbbr || address?.state)) {
      // If no address, create a new property without address matching
      return this.createProperty({ name: propertyName, address });
    }

    // Try to find existing property with same normalized address
    const existing = await this.findByNormalizedAddress(normalizedAddr);
    
    if (existing) {
      console.log(`[PropertyService] Found existing property ${existing.id} for address: ${normalizedAddr}`);
      return existing;
    }

    // Create new property
    return this.createProperty({ name: propertyName, address, normalizedAddress: normalizedAddr });
  }

  /**
   * Find property by normalized address.
   * Only returns active (non-deleted) properties.
   * 
   * @param {string} normalizedAddress - Normalized address string
   * @returns {Promise<Object|null>} Property or null
   */
  async findByNormalizedAddress(normalizedAddress) {
    const result = await db.query(
      `SELECT * FROM properties 
       WHERE address_normalized = $1 
       AND deleted_at IS NULL 
       LIMIT 1`,
      [normalizedAddress]
    );
    return result.rows[0] || null;
  }

  /**
   * Create a new property.
   * 
   * @param {Object} data - Property data
   * @returns {Promise<Object>} Created property
   */
  async createProperty(data) {
    const { name, address = {}, normalizedAddress } = data;
    
    const result = await db.query(
      `INSERT INTO properties (
        name, address_street, address_city, address_state, address_state_abbr,
        address_zip, address_full, address_normalized, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
      RETURNING *`,
      [
        name || address.propertyName,
        address.street,
        address.city,
        address.state,
        address.stateAbbr,
        address.zipCode,
        address.fullAddress,
        normalizedAddress || buildNormalizedAddress(address)
      ]
    );

    console.log(`[PropertyService] Created property ${result.rows[0].id}: ${name || address.fullAddress}`);
    return result.rows[0];
  }

  /**
   * Get property by ID.
   * 
   * @param {number} id - Property ID
   * @param {boolean} includeDeleted - Include soft-deleted properties
   * @returns {Promise<Object|null>} Property or null
   */
  async getById(id, includeDeleted = false) {
    const query = includeDeleted
      ? `SELECT * FROM properties WHERE id = $1`
      : `SELECT * FROM properties WHERE id = $1 AND deleted_at IS NULL`;
    
    const result = await db.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Get all properties with their scores.
   * 
   * @param {Object} options - Query options
   * @param {boolean} options.includeDeleted - Include soft-deleted properties
   * @param {string} options.status - Filter by status ('active', 'deleted')
   * @returns {Promise<Array>} List of properties with scores
   */
  async getAllWithScores(options = {}) {
    const { includeDeleted = false, status } = options;
    
    let whereClause = '';
    const params = [];
    
    if (status === 'deleted') {
      whereClause = 'WHERE p.deleted_at IS NOT NULL';
    } else if (!includeDeleted) {
      whereClause = 'WHERE p.deleted_at IS NULL';
    }

    const result = await db.query(
      `SELECT 
        p.*,
        s.score,
        s.decision,
        s.decision_color,
        s.breakdown,
        s.calculated_at
       FROM properties p
       LEFT JOIN scores s ON s.property_id = p.id
       ${whereClause}
       ORDER BY p.created_at DESC`,
      params
    );

    return result.rows;
  }

  /**
   * Get property with all related data (documents, extracted files, score).
   * 
   * @param {number} id - Property ID
   * @returns {Promise<Object|null>} Property with related data
   */
  async getWithRelatedData(id) {
    const property = await this.getById(id, true);
    if (!property) return null;

    // Get documents
    const documents = await db.query(
      `SELECT * FROM documents WHERE property_id = $1 ORDER BY uploaded_at DESC`,
      [id]
    );

    // Get extracted files
    const extractedFiles = await db.query(
      `SELECT * FROM extracted_files WHERE property_id = $1 ORDER BY section_type`,
      [id]
    );

    // Get score
    const score = await db.query(
      `SELECT * FROM scores WHERE property_id = $1`,
      [id]
    );

    // Get generated files
    const generatedFiles = await db.query(
      `SELECT * FROM generated_files WHERE property_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    return {
      ...property,
      documents: documents.rows,
      extractedFiles: extractedFiles.rows,
      score: score.rows[0] || null,
      generatedFiles: generatedFiles.rows
    };
  }

  /**
   * Link a document to a property.
   * 
   * @param {number} propertyId - Property ID
   * @param {Object} documentData - Document data
   * @returns {Promise<Object>} Created document record
   */
  async linkDocument(propertyId, documentData) {
    const { filename, originalFilename, fileType, fileSize, storagePath, userId = '000' } = documentData;

    const result = await db.query(
      `INSERT INTO documents (
        property_id, filename, original_filename, file_type, file_size, storage_path, user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [propertyId, filename, originalFilename, fileType, fileSize, storagePath, userId]
    );

    console.log(`[PropertyService] Linked document ${result.rows[0].id} to property ${propertyId}`);
    return result.rows[0];
  }

  /**
   * Link an extracted file to a property and document.
   * 
   * @param {number} propertyId - Property ID
   * @param {number} documentId - Document ID (can be null)
   * @param {Object} extractedData - Extracted file data
   * @returns {Promise<Object>} Created extracted file record
   */
  async linkExtractedFile(propertyId, documentId, extractedData) {
    const { sectionType, storagePath, dataHash } = extractedData;

    const result = await db.query(
      `INSERT INTO extracted_files (
        property_id, document_id, section_type, storage_path, data_hash
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [propertyId, documentId, sectionType, storagePath, dataHash]
    );

    return result.rows[0];
  }

  /**
   * Save or update score for a property.
   * 
   * @param {number} propertyId - Property ID
   * @param {Object} scoreData - Score data from scoring service
   * @param {Object} rawData - Raw input data used for scoring
   * @param {Object} config - Scorecard config at time of calculation
   * @returns {Promise<Object>} Saved score record
   */
  async saveScore(propertyId, scoreData, rawData = null, config = null) {
    const { score, decision, decisionColor, breakdown } = scoreData;

    // Upsert: update if exists, insert if not
    const result = db.transaction(client => {
      if (rawData?.reportRevisionId) {
        const latest = client.query('SELECT id FROM report_revisions WHERE property_id = $1 ORDER BY id DESC LIMIT 1', [propertyId]).rows[0];
        if (latest?.id !== rawData.reportRevisionId) throw new Error('Report revision changed during scoring; retry against current evidence');
      }
      return client.query(
      `INSERT INTO scores (
        property_id, score, decision, decision_color, breakdown, raw_data, config_snapshot
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (property_id) DO UPDATE SET
        score = EXCLUDED.score,
        decision = EXCLUDED.decision,
        decision_color = EXCLUDED.decision_color,
        breakdown = EXCLUDED.breakdown,
        raw_data = EXCLUDED.raw_data,
        config_snapshot = EXCLUDED.config_snapshot,
        calculated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [propertyId, score, decision, decisionColor, breakdown, rawData, config]
    );
    });

    console.log(`[PropertyService] Saved score ${score} for property ${propertyId}`);
    return result.rows[0];
  }

  /**
   * Link a generated file to a property.
   * 
   * @param {number} propertyId - Property ID
   * @param {Object} fileData - Generated file data
   * @returns {Promise<Object>} Created generated file record
   */
  async linkGeneratedFile(propertyId, fileData) {
    const { fileType, fileName, storagePath, templateUsed } = fileData;

    const result = await db.query(
      `INSERT INTO generated_files (
        property_id, file_type, file_name, storage_path, template_used
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [propertyId, fileType, fileName, storagePath, templateUsed]
    );

    return result.rows[0];
  }

  /**
   * Soft delete a property and all related data.
   * Sets deleted_at timestamp on property and cascades to related records.
   * 
   * @param {number} id - Property ID
   * @returns {Promise<Object>} Updated property
   */
  async softDelete(id) {
    const now = new Date();

    // Start transaction
    return db.transaction((client) => {

      // Soft delete property
      const propertyResult = client.query(
        `UPDATE properties SET deleted_at = $1, status = 'deleted' WHERE id = $2 RETURNING *`,
        [now, id]
      );

      if (propertyResult.rows.length === 0) {
        throw new Error(`Property ${id} not found`);
      }

      // Soft delete related documents
      client.query(
        `UPDATE documents SET deleted_at = $1 WHERE property_id = $2`,
        [now, id]
      );

      // Soft delete related extracted files
      client.query(
        `UPDATE extracted_files SET deleted_at = $1 WHERE property_id = $2`,
        [now, id]
      );

      // Soft delete related generated files
      client.query(
        `UPDATE generated_files SET deleted_at = $1 WHERE property_id = $2`,
        [now, id]
      );

      // Note: We keep scores in the database for audit trail, 
      // they will be cascade deleted when property is permanently deleted



      console.log(`[PropertyService] Soft deleted property ${id} and related data`);
      return propertyResult.rows[0];

    });
  }

  /**
   * Restore a soft-deleted property and all related data.
   * Clears deleted_at timestamp on property and related records.
   * 
   * @param {number} id - Property ID
   * @returns {Promise<Object>} Restored property
   */
  async restore(id) {
    return db.transaction((client) => {

      // Restore property
      const propertyResult = client.query(
        `UPDATE properties SET deleted_at = NULL, status = 'active' WHERE id = $1 RETURNING *`,
        [id]
      );

      if (propertyResult.rows.length === 0) {
        throw new Error(`Property ${id} not found`);
      }

      // Restore related documents
      client.query(
        `UPDATE documents SET deleted_at = NULL WHERE property_id = $1`,
        [id]
      );

      // Restore related extracted files
      client.query(
        `UPDATE extracted_files SET deleted_at = NULL WHERE property_id = $1 AND superseded = 0`,
        [id]
      );

      // Restore related generated files
      client.query(
        `UPDATE generated_files SET deleted_at = NULL WHERE property_id = $1`,
        [id]
      );



      console.log(`[PropertyService] Restored property ${id} and related data`);
      return propertyResult.rows[0];

    });
  }

  /**
   * Permanently delete a property and all related data.
   * This removes all database records AND files from the filesystem.
   * 
   * @param {number} id - Property ID
   * @returns {Promise<boolean>} Success status
   */
  async permanentDelete(id) {
    const snapshot = db.transaction((client) => {
      if (!client.query('SELECT id FROM properties WHERE id = $1', [id]).rows.length) throw new Error(`Property ${id} not found`);
      const revisions = client.query('SELECT * FROM report_revisions WHERE property_id = $1', [id]).rows;
      const documents = client.query('SELECT * FROM documents WHERE property_id = $1', [id]).rows;
      const extractedFiles = client.query('SELECT * FROM extracted_files WHERE property_id = $1', [id]).rows;
      const generatedFiles = client.query('SELECT * FROM generated_files WHERE property_id = $1', [id]).rows;
      const sourceFiles = client.query(`SELECT DISTINCT f.* FROM files f LEFT JOIN documents d ON d.storage_path=f.storage_path
        LEFT JOIN report_revisions r ON r.file_id=f.id WHERE d.property_id=$1 OR r.property_id=$1`, [id]).rows;
      for (const file of sourceFiles) {
        if (client.query("SELECT id FROM extraction_jobs WHERE file_id=$1 AND status IN ('queued','running')", [file.id]).rows.length)
          throw Object.assign(new Error('Wait for the active extraction before permanently deleting this property'), {statusCode: 409});
      }
      client.query('DELETE FROM report_revisions WHERE property_id = $1', [id]);
      for (const table of ['generated_files', 'extracted_files', 'scores', 'documents']) client.query(`DELETE FROM ${table} WHERE property_id = $1`, [id]);
      client.query('DELETE FROM properties WHERE id = $1', [id]);
      for (const file of sourceFiles) {
        const shared = client.query(`SELECT id FROM report_revisions WHERE file_id=$1 UNION ALL SELECT id FROM documents WHERE storage_path=$2`, [file.id,file.storage_path]).rows.length;
        if (!shared) {
          client.query('DELETE FROM extraction_jobs WHERE file_id=$1', [file.id]);
          client.query('DELETE FROM files WHERE id=$1', [file.id]);
        }
      }
      return {documents, extractedFiles, generatedFiles, revisions};
    });
    await this._deletePhysicalFiles(snapshot);
    for (const revision of snapshot.revisions) {
      await fs.unlink(resolveUploadPath(revision.evidence_path)).catch(error => {if(error.code !== 'ENOENT') throw error;});
      if (/^[a-f0-9]{64}$/.test(revision.source_sha256) && !(await db.query('SELECT id FROM report_revisions WHERE source_sha256=$1', [revision.source_sha256])).rows.length) {
        await fs.rm(path.join(EXTRACTED_DIR, '.checkpoints', revision.source_sha256), {recursive: true, force: true});
      }
    }
    return true;
  }

  /**
   * Delete physical files associated with a property.
   * 
   * @param {Object} property - Property with related data
   */
  async _deletePhysicalFiles(property) {
    const filesToDelete = [];

    // Collect document files
    for (const doc of property.documents || []) {
      if (doc.storage_path) {
        filesToDelete.push(resolveUploadPath(doc.storage_path));
      }
    }

    // Collect extracted files
    for (const ef of property.extractedFiles || []) {
      if (ef.storage_path) {
        filesToDelete.push(resolveUploadPath(ef.storage_path));
      }
    }

    // Collect generated files
    for (const gf of property.generatedFiles || []) {
      if (gf.storage_path) {
        filesToDelete.push(resolveUploadPath(gf.storage_path));
      }
    }

    // Delete files (ignore errors for missing files)
    for (const filePath of filesToDelete) {
      const storedPath = path.relative(UPLOADS_DIR, filePath);
      const stillReferenced = (await db.query(`SELECT id FROM files WHERE storage_path=$1
        UNION ALL SELECT id FROM documents WHERE storage_path=$1
        UNION ALL SELECT id FROM extracted_files WHERE storage_path=$1
        UNION ALL SELECT id FROM generated_files WHERE storage_path=$1`, [storedPath])).rows.length;
      if (stillReferenced) continue;
      try {
        await fs.unlink(filePath);
        console.log(`[PropertyService] Deleted file: ${filePath}`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error(`[PropertyService] Error deleting file ${filePath}:`, error.message);
        }
      }
    }
  }

  /**
   * Get properties pending permanent deletion (soft-deleted > 30 days ago).
   * 
   * @returns {Promise<Array>} List of properties pending permanent deletion
   */
  async getPendingPermanentDeletion() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await db.query(
      `SELECT * FROM properties 
       WHERE deleted_at IS NOT NULL 
       AND deleted_at < $1
       ORDER BY deleted_at ASC`,
      [thirtyDaysAgo]
    );

    return result.rows;
  }

  /**
   * Permanently delete all properties that have been soft-deleted for > 30 days.
   * This should be called periodically (e.g., cron job).
   * 
   * @returns {Promise<number>} Number of properties permanently deleted
   */
  async cleanupOldDeletedProperties() {
    const pending = await this.getPendingPermanentDeletion();
    let deleted = 0;

    for (const property of pending) {
      try {
        await this.permanentDelete(property.id);
        deleted++;
      } catch (error) {
        console.error(`[PropertyService] Failed to permanently delete property ${property.id}:`, error.message);
      }
    }

    console.log(`[PropertyService] Cleanup: permanently deleted ${deleted} properties`);
    return deleted;
  }

  /**
   * Update property details.
   * 
   * @param {number} id - Property ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated property
   */
  async update(id, updates) {
    const allowedFields = ['name', 'address_street', 'address_city', 'address_state', 
                          'address_state_abbr', 'address_zip', 'address_full'];
    
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      return this.getById(id);
    }

    // Recalculate normalized address if address fields changed
    if (updates.address_street || updates.address_city || updates.address_state_abbr) {
      const current = await this.getById(id);
      const newAddress = {
        street: updates.address_street || current.address_street,
        city: updates.address_city || current.address_city,
        stateAbbr: updates.address_state_abbr || current.address_state_abbr
      };
      setClauses.push(`address_normalized = $${paramIndex}`);
      values.push(buildNormalizedAddress(newAddress));
      paramIndex++;
    }

    values.push(id);
    
    const result = await db.query(
      `UPDATE properties SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    return result.rows[0];
  }

  /**
   * Get summary statistics for properties.
   * 
   * @returns {Promise<Object>} Summary statistics
   */
  async getSummaryStats() {
    const result = await db.query(`
      SELECT
        SUM(CASE WHEN p.deleted_at IS NULL THEN 1 ELSE 0 END) as active_count,
        SUM(CASE WHEN p.deleted_at IS NOT NULL THEN 1 ELSE 0 END) as deleted_count,
        SUM(CASE WHEN s.decision = 'Move Forward' AND p.deleted_at IS NULL THEN 1 ELSE 0 END) as move_forward,
        SUM(CASE WHEN s.decision = 'Needs Review' AND p.deleted_at IS NULL THEN 1 ELSE 0 END) as needs_review,
        SUM(CASE WHEN s.decision = 'Rejected' AND p.deleted_at IS NULL THEN 1 ELSE 0 END) as rejected,
        AVG(CASE WHEN p.deleted_at IS NULL THEN s.score END) as average_score
      FROM properties p
      LEFT JOIN scores s ON s.property_id = p.id
    `);

    const row = result.rows[0];
    return {
      count: parseInt(row.active_count) || 0,
      deletedCount: parseInt(row.deleted_count) || 0,
      moveForward: parseInt(row.move_forward) || 0,
      quickCheck: parseInt(row.needs_review) || 0,  // Keeping old name for backward compatibility
      needsReview: parseInt(row.needs_review) || 0,
      dontMove: parseInt(row.rejected) || 0,        // Keeping old name for backward compatibility
      rejected: parseInt(row.rejected) || 0,
      averageScore: parseFloat(row.average_score) || 0
    };
  }
}

export { PropertyService, normalizeAddress, buildNormalizedAddress };
