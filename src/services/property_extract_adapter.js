/**
 * PropertyExtract adapter — bridges docling_full section files to the
 * structured_data[0] shape expected by field_mappings.json / XLSX fill.
 *
 * Interface:
 *   loadSectionsFromDir(extractedDir, baseName) → sections map
 *   assembleFillPayload(sections) → { processing_status, structured_data: [obj], ... }
 *   assembleFillPayloadFromBaseName(extractedDir, baseName)
 *
 * Does not invent fill data: reuses DoclingTransformer on real section content.
 * If transformation yields empty structured fields, that emptiness is preserved.
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { SECTION_TYPES } from './costar_extract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRANSFORMER_PATH = path.join(__dirname, 'processors', 'docling_transformer.py');
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const VENV_PYTHON = path.join(PROJECT_ROOT, '.venv', 'bin', 'python');

async function resolvePythonPath() {
  try {
    await fs.access(VENV_PYTHON);
    return VENV_PYTHON;
  } catch {
    return 'python3';
  }
}

/**
 * Load section JSON files for a docling_full extraction base name.
 */
export async function loadSectionsFromDir(extractedDir, baseName) {
  const sections = {};
  let files;
  try {
    files = await fs.readdir(extractedDir);
  } catch {
    return sections;
  }

  for (const file of files) {
    if (!file.startsWith(baseName) || !file.endsWith('.json')) continue;
    for (const sectionType of SECTION_TYPES) {
      if (file === `${baseName}_${sectionType}.json`) {
        const content = await fs.readFile(path.join(extractedDir, file), 'utf-8');
        sections[sectionType] = JSON.parse(content);
        break;
      }
    }
  }
  return sections;
}

/**
 * Flatten selected section objects into a DoclingTransformer-compatible input.
 * Uses only data present in the section files — no synthetic fields.
 *
 * Prefer subject_property (and optionally rent_comps) so construction/submarket
 * headers do not overwrite property address/name in the transformer.
 */
export function sectionsToDoclingInput(sections, options = {}) {
  const preferred =
    options.sectionTypes ||
    (sections?.subject_property
      ? ['subject_property', 'rent_comps'].filter((k) => sections[k])
      : Object.keys(sections || {}).filter((k) => k !== 'external'));

  const tables = [];
  const pages = [];
  const rawTextParts = [];
  const sectionList = [];

  for (const sectionType of preferred) {
    const data = sections?.[sectionType];
    if (!data || typeof data !== 'object') continue;

    if (Array.isArray(data.tables)) {
      tables.push(...data.tables);
    }
    if (Array.isArray(data.pages)) {
      for (const page of data.pages) {
        pages.push(page);
        if (Array.isArray(page.tables)) {
          tables.push(...page.tables);
        }
      }
    }
    if (data.raw_text) {
      rawTextParts.push(data.raw_text);
    }

    sectionList.push({
      header: data.section_name || data.section || sectionType,
      content: data.raw_text ? [data.raw_text] : [],
      section_type: sectionType,
      page_range: data.page_range,
    });
  }

  return {
    processing_status: 'success',
    metadata: {
      page_count: pages.length || undefined,
      processor: 'docling_full_sections',
      section_types: preferred,
    },
    tables,
    sections: sectionList,
    pages,
    raw_text: rawTextParts.join('\n\n'),
  };
}

async function runPythonTransformer(doclingInput) {
  const tempPath = path.join(
    __dirname,
    'processors',
    `temp_sections_${Date.now()}.json`
  );
  await fs.writeFile(tempPath, JSON.stringify(doclingInput));
  const pythonPath = await resolvePythonPath();

  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, [TRANSFORMER_PATH, tempPath], {
      cwd: PROJECT_ROOT,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const cleanup = async () => {
      try {
        await fs.unlink(tempPath);
      } catch {
        // ignore
      }
    };

    child.on('error', async (err) => {
      await cleanup();
      reject(
        new Error(
          `Failed to spawn Python for DoclingTransformer (${pythonPath}): ${err.message}`
        )
      );
    });

    child.on('close', async (code) => {
      await cleanup();
      if (code !== 0) {
        reject(new Error(stderr || `DoclingTransformer exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`Failed to parse transformer output: ${e.message}`));
      }
    });
  });
}

/**
 * Assemble fill payload: { structured_data: [ ... ] } for field_mappings.json.
 *
 * @param {Object} sections - map of section_type → parsed section JSON
 * @returns {Promise<Object>} fill-ready JSON (includes structured_data[0])
 */
export async function assembleFillPayload(sections) {
  if (!sections || Object.keys(sections).length === 0) {
    throw new Error('No section data to assemble for XLSX fill');
  }

  const doclingInput = sectionsToDoclingInput(sections);
  if (!doclingInput.tables.length && !doclingInput.raw_text.trim()) {
    throw new Error('Section files contain no tables or text to transform');
  }

  const transformed = await runPythonTransformer(doclingInput);

  if (transformed.processing_status === 'error') {
    throw new Error(transformed.error_message || 'DoclingTransformer failed');
  }

  if (!transformed.structured_data?.[0]) {
    throw new Error('Transformer returned no structured_data[0]');
  }

  return {
    ...transformed,
    source: 'docling_full_sections',
    section_types: Object.keys(sections),
  };
}

/**
 * Load sections for baseName and assemble fill payload.
 */
export async function assembleFillPayloadFromBaseName(extractedDir, baseName) {
  const sections = await loadSectionsFromDir(extractedDir, baseName);
  if (!sections.subject_property && Object.keys(sections).length === 0) {
    throw new Error(`No section files found for baseName: ${baseName}`);
  }
  return assembleFillPayload(sections);
}
