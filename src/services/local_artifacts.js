/**
 * Local Docling artifact verifier.
 *
 * Interface:
 *   verifyDoclingArtifacts(path?) -> { manifestPath, fileCount }
 *
 * The manifest is the machine-provisioning handoff. Requiring a checksum for
 * every artifact makes an empty cache or an accidental model download fail
 * before any document conversion starts.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { DOCLING_ARTIFACTS_PATH, assertLocalStatePath } from '../config/runtime_paths.js';

export const DOCLING_ARTIFACT_MANIFEST = 'serafina-artifacts.manifest.json';

function resolveArtifactPath(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Artifact manifest contains an invalid path: ${relativePath}`);
  }
  return resolved;
}

async function sha256(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function verifyDoclingArtifacts(artifactsPath = DOCLING_ARTIFACTS_PATH) {
  const root = assertLocalStatePath(artifactsPath, 'SERAFINA_DOCLING_ARTIFACTS_PATH');
  const manifestPath = path.join(root, DOCLING_ARTIFACT_MANIFEST);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
  } catch (error) {
    throw new Error(`Docling artifact manifest is required at ${manifestPath}: ${error.message}`);
  }

  if (manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`Docling artifact manifest ${manifestPath} must contain version 1 and non-empty files`);
  }

  for (const artifact of manifest.files) {
    if (!artifact || typeof artifact.path !== 'string' || !/^[a-f0-9]{64}$/i.test(artifact.sha256 || '')) {
      throw new Error(`Docling artifact manifest has an invalid artifact entry in ${manifestPath}`);
    }
    const artifactPath = resolveArtifactPath(root, artifact.path);
    const actualHash = await sha256(artifactPath);
    if (actualHash !== artifact.sha256.toLowerCase()) {
      throw new Error(`Docling artifact checksum mismatch: ${artifact.path}`);
    }
  }

  return { manifestPath, fileCount: manifest.files.length };
}
