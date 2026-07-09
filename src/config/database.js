/**
 * SQLite-backed local persistence module.
 *
 * Interface preserved for callers:
 *   db.query(sql, params?) -> { rows, rowCount }
 *   db.connect() -> transaction client with query/release
 *   initDb() -> initialize local schema
 *
 * The adapter keeps existing modules focused on property behaviour rather than
 * database mechanics. It intentionally supports one local application process;
 * no network database is part of the runtime.
 */

import { DatabaseSync } from 'node:sqlite';
import { ensureDataDirectories, DATABASE_PATH } from './runtime_paths.js';

let database = null;

const JSON_COLUMNS = new Set(['breakdown', 'raw_data', 'config_snapshot', 'records_json']);

function getDatabase() {
  if (!database) {
    throw new Error('Local database is not initialized. Run initDb() before handling requests.');
  }
  return database;
}

function toSqliteSql(sql) {
  return sql
    .replace(/\$\d+/g, '?')
    .replace(/\bILIKE\b/gi, 'LIKE');
}

function toSqliteParameter(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) return JSON.stringify(value);
  return value;
}

function hydrateRow(row) {
  const hydrated = { ...row };
  for (const column of JSON_COLUMNS) {
    if (typeof hydrated[column] === 'string') {
      try {
        hydrated[column] = JSON.parse(hydrated[column]);
      } catch {
        // Preserve malformed historic data for inspection instead of inventing values.
      }
    }
  }
  return hydrated;
}

function isRowQuery(sql) {
  return /^(?:\s*(?:WITH\b[\s\S]*?\b)?(?:SELECT|PRAGMA|EXPLAIN)\b)/i.test(sql)
    || /\bRETURNING\b/i.test(sql);
}

class LocalDatabase {
  async query(sql, params = []) {
    const statement = getDatabase().prepare(toSqliteSql(sql));
    const values = params.map(toSqliteParameter);

    if (isRowQuery(sql)) {
      const rows = statement.all(...values).map(hydrateRow);
      return { rows, rowCount: rows.length };
    }

    const result = statement.run(...values);
    return {
      rows: [],
      rowCount: Number(result.changes || 0),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  async connect() {
    // A single DatabaseSync connection is intentional: Serafina has one local
    // writer, which avoids cross-process locking complexity for user data.
    return {
      query: this.query.bind(this),
      release() {},
    };
  }

  close() {
    if (database) {
      database.close();
      database = null;
    }
  }
}

const db = new LocalDatabase();

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    user_id TEXT NOT NULL DEFAULT '000',
    storage_path TEXT NOT NULL,
    upload_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'active',
    is_extracted INTEGER NOT NULL DEFAULT 0,
    extracted_text TEXT
  );

  CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY,
    name TEXT,
    address_street TEXT,
    address_city TEXT,
    address_state TEXT,
    address_state_abbr TEXT,
    address_zip TEXT,
    address_full TEXT,
    address_normalized TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '000',
    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS extracted_files (
    id INTEGER PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    section_type TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    data_hash TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE UNIQUE,
    score REAL NOT NULL,
    decision TEXT NOT NULL,
    decision_color TEXT NOT NULL,
    breakdown TEXT,
    raw_data TEXT,
    config_snapshot TEXT,
    calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS generated_files (
    id INTEGER PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
    file_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    template_used TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS reference_snapshots (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    as_of TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    content_hash TEXT NOT NULL UNIQUE,
    records_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_properties_address_normalized ON properties(address_normalized);
  CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
  CREATE INDEX IF NOT EXISTS idx_documents_property_id ON documents(property_id);
  CREATE INDEX IF NOT EXISTS idx_extracted_files_property_id ON extracted_files(property_id);
  CREATE INDEX IF NOT EXISTS idx_scores_property_id ON scores(property_id);
  CREATE INDEX IF NOT EXISTS idx_generated_files_property_id ON generated_files(property_id);
  CREATE INDEX IF NOT EXISTS idx_reference_snapshots_as_of ON reference_snapshots(as_of);

  CREATE TRIGGER IF NOT EXISTS update_properties_updated_at
  AFTER UPDATE ON properties
  FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
  BEGIN
    UPDATE properties SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS update_scores_updated_at
  AFTER UPDATE ON scores
  FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
  BEGIN
    UPDATE scores SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;
`;

export async function initDb() {
  await ensureDataDirectories();
  if (!database) {
    database = new DatabaseSync(DATABASE_PATH, { timeout: 5_000 });
  }

  // SQLite 3.51.3+ is bundled by the supported local Node runtime. We stay in
  // rollback-journal mode until this app has measured a workload that benefits
  // from WAL. That is deliberate: a single local writer does not need WAL and
  // this avoids filesystem-sync and multi-process WAL failure modes.
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 5000;');
  database.exec(SCHEMA);
  return { path: DATABASE_PATH };
}

export { db };
