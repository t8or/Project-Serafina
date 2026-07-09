/**
 * Local runtime paths.
 *
 * This module is the single seam for mutable application state. Source code can
 * live in a synced working copy; databases, uploads, generated spreadsheets,
 * and downloaded model artifacts must not. SQLite's locking files are local to
 * the machine, so keeping them out of iCloud/Dropbox avoids corrupted state.
 */

import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import dotenv from 'dotenv';

// Load local overrides before resolving exported constants. All entry points
// import this module, including local:doctor and local:setup.
dotenv.config({ quiet: true });

const projectRoot = process.cwd();
const platformDefaultDataDir = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Project Serafina')
  : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'project-serafina');

export const DATA_DIR = path.resolve(process.env.SERAFINA_DATA_DIR || platformDefaultDataDir);
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const DOCUMENTS_DIR = path.join(UPLOADS_DIR, 'documents');
export const EXTRACTED_DIR = path.join(UPLOADS_DIR, 'extracted');
export const FILLED_DIR = path.join(UPLOADS_DIR, 'filled');
export const CONFIG_DIR = path.join(DATA_DIR, 'config');
export const MODELS_DIR = path.join(DATA_DIR, 'models');
export const DOCLING_ARTIFACTS_PATH = path.resolve(
  process.env.SERAFINA_DOCLING_ARTIFACTS_PATH || path.join(MODELS_DIR, 'docling')
);
export const DATABASE_PATH = path.join(DATA_DIR, 'serafina.sqlite');
export const SCORECARD_CONFIG_PATH = path.join(CONFIG_DIR, 'scorecard_config.json');
export const LOCAL_PYTHON_PATH = path.resolve(
  process.env.SERAFINA_PYTHON || path.join(projectRoot, '.venv', 'bin', 'python')
);
export const OLLAMA_BASE_URL = process.env.SERAFINA_OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
export const OLLAMA_MODEL = process.env.SERAFINA_OLLAMA_MODEL || 'qwen2.5:7b';

function isWithin(parent, child) {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

export function assertLocalStatePath(value, label) {
  const resolved = path.resolve(value);
  const workspace = path.resolve(projectRoot);
  const syncedPathMarkers = [
    `${path.sep}Mobile Documents${path.sep}`,
    `${path.sep}Library${path.sep}CloudStorage${path.sep}`,
    `${path.sep}Dropbox${path.sep}`,
  ];

  if (isWithin(workspace, resolved)) {
    throw new Error(`${label} must be outside the source checkout: ${resolved}`);
  }
  if (syncedPathMarkers.some((marker) => resolved.includes(marker))) {
    throw new Error(`${label} must be on a local non-synced filesystem: ${resolved}`);
  }
  return resolved;
}

export function assertLoopbackHost(host) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`SERAFINA_HOST must be loopback-only; received ${host}`);
  }
}

export function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function assertLoopbackUrl(value, label) {
  if (!isLoopbackUrl(value)) {
    throw new Error(`${label} must be an http loopback URL; received ${value}`);
  }
}

export async function ensureDataDirectories() {
  assertLocalStatePath(DATA_DIR, 'SERAFINA_DATA_DIR');
  assertLocalStatePath(DOCLING_ARTIFACTS_PATH, 'SERAFINA_DOCLING_ARTIFACTS_PATH');
  await Promise.all([
    fs.mkdir(DOCUMENTS_DIR, { recursive: true }),
    fs.mkdir(EXTRACTED_DIR, { recursive: true }),
    fs.mkdir(FILLED_DIR, { recursive: true }),
    fs.mkdir(CONFIG_DIR, { recursive: true }),
    fs.mkdir(MODELS_DIR, { recursive: true }),
  ]);
}

export function relativeUploadPath(absolutePath) {
  const relativePath = path.relative(UPLOADS_DIR, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Path is outside local upload storage: ${absolutePath}`);
  }
  return relativePath;
}

export function resolveUploadPath(relativePath) {
  const resolved = path.resolve(UPLOADS_DIR, relativePath);
  if (!resolved.startsWith(`${UPLOADS_DIR}${path.sep}`) && resolved !== UPLOADS_DIR) {
    throw new Error(`Invalid upload storage path: ${relativePath}`);
  }
  return resolved;
}

/**
 * TODO(local-runtime): Provision this directory on the destination machine
 * before starting Serafina. The application deliberately never downloads
 * Docling artifacts or an Ollama model at runtime.
 */
export const LOCAL_RUNTIME_PROVISIONING_NOTE =
  'Provision Docling artifacts and the configured Ollama model before local:start.';
