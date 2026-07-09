/**
 * LocalReferenceData — imports and looks up user-provided reference snapshots.
 *
 * Interface:
 *   importSnapshot(snapshot) -> { id, source, asOf, recordCount }
 *   lookup(address) -> { available, data?, provenance?, reason? }
 *
 * This module has no network implementation. Fresh crime, school, or walkability
 * data must be supplied as a local snapshot with source and as-of provenance.
 */

import crypto from 'crypto';
import { db } from '../config/database.js';
import { buildNormalizedAddress } from './property_service.js';

function normalizedAddress(address = {}) {
  return address.normalizedAddress
    ? String(address.normalizedAddress).trim().toLowerCase()
    : buildNormalizedAddress(address);
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Reference snapshot must be a JSON object');
  }
  if (typeof snapshot.source !== 'string' || !snapshot.source.trim()) {
    throw new Error('Reference snapshot requires a non-empty source');
  }
  if (typeof snapshot.asOf !== 'string' || Number.isNaN(Date.parse(snapshot.asOf))) {
    throw new Error('Reference snapshot requires an ISO-compatible asOf date');
  }
  if (!Array.isArray(snapshot.records) || snapshot.records.length === 0) {
    throw new Error('Reference snapshot requires at least one record');
  }

  for (const [index, record] of snapshot.records.entries()) {
    if (!record || typeof record !== 'object' || !normalizedAddress(record.address)) {
      throw new Error(`Reference record ${index} requires an address`);
    }
  }
}

function contentHash(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

class LocalReferenceData {
  async importSnapshot(snapshot) {
    validateSnapshot(snapshot);
    const hash = contentHash(snapshot);

    const existing = await db.query(
      'SELECT id, source, as_of FROM reference_snapshots WHERE content_hash = $1',
      [hash]
    );
    if (existing.rows[0]) {
      return { ...existing.rows[0], recordCount: snapshot.records.length, alreadyImported: true };
    }

    const inserted = await db.query(
      `INSERT INTO reference_snapshots (source, as_of, content_hash, records_json)
       VALUES ($1, $2, $3, $4)
       RETURNING id, source, as_of, imported_at`,
      [snapshot.source.trim(), snapshot.asOf, hash, snapshot.records]
    );

    return { ...inserted.rows[0], recordCount: snapshot.records.length, alreadyImported: false };
  }

  async getStatus() {
    const result = await db.query(
      `SELECT id, source, as_of, imported_at
       FROM reference_snapshots
       ORDER BY as_of DESC, imported_at DESC`
    );
    return result.rows;
  }

  async lookup(address) {
    const target = normalizedAddress(address);
    if (!target) {
      return { available: false, reason: 'A complete property address is required for local lookup' };
    }

    const snapshots = await db.query(
      `SELECT id, source, as_of, imported_at, records_json
       FROM reference_snapshots
       ORDER BY as_of DESC, imported_at DESC`
    );

    for (const snapshot of snapshots.rows) {
      if (!Array.isArray(snapshot.records_json)) {
        throw new Error(`Reference snapshot ${snapshot.id} has malformed records_json`);
      }
      const records = snapshot.records_json;
      const record = records.find((candidate) => normalizedAddress(candidate.address) === target);
      if (record) {
        const { address: _address, ...data } = record;
        return {
          available: true,
          data,
          provenance: {
            snapshotId: snapshot.id,
            source: snapshot.source,
            asOf: snapshot.as_of,
            importedAt: snapshot.imported_at,
          },
        };
      }
    }

    return { available: false, reason: 'No local reference snapshot contains this property address' };
  }
}

export { LocalReferenceData, normalizedAddress as normalizeReferenceAddress };
