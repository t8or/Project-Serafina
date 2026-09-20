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
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { AddressExtractor } from './address_extractor.js';
import { assemblePropertyData } from './property_data_assembler.js';
import { SECTION_TYPES, extractDemographicsFromDocling } from './costar_extract.js';
import { LOCAL_PYTHON_PATH } from '../config/runtime_paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRANSFORMER_PATH = path.join(__dirname, 'processors', 'docling_transformer.py');
const PROJECT_ROOT = path.resolve(__dirname, '../..');
async function resolvePythonPath() {
  try {
    await fs.access(LOCAL_PYTHON_PATH);
    return LOCAL_PYTHON_PATH;
  } catch (error) {
    throw new Error(
      `Local Python is unavailable at ${LOCAL_PYTHON_PATH}. Set SERAFINA_PYTHON after provisioning. ${error.message}`
    );
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
      ? ['subject_property']
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
      content: data.raw_text ? data.raw_text.split(/\r?\n/).filter(Boolean) : [],
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
    raw_text: [...rawTextParts, ...tables.map(table => table.markdown || '')].join('\n\n'),
  };
}

async function runPythonTransformer(doclingInput) {
  const tempPath = path.join(os.tmpdir(), `serafina-transform-${crypto.randomUUID()}.json`);
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
export async function assembleFillPayload(sections, options = {}) {
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

  const address = new AddressExtractor().extractFromSubjectProperty(sections.subject_property);
  const subject = transformed.structured_data[0];
  const property = subject.property;
  const projection = options.projection || assemblePropertyData(sections, address);
  const oneMile = extractDemographicsFromDocling(sections.demographics, null, 1);
  const fiveMile = extractDemographicsFromDocling(sections.demographics, null, 5);
  subject.demographics = {...oneMile, ...fiveMile, ...projection.demographics};
  subject.submarket = projection.submarket;
  subject.external = projection.external;
  subject.property_metrics = projection.property;
  if (subject.unitBreakdown?.length) {
    subject.unitBreakdownSourceTables = subject.unitBreakdown;
    subject.unitBreakdown = [{...subject.unitBreakdown[0], rows: subject.unitBreakdown.flatMap(table => table.rows || [])}];
    const detailRows = subject.unitBreakdown[0].rows.filter(row => typeof row.bed === 'number' && typeof row.bath === 'number');
    const units = detailRows.map(row => row['unitMix.units']);
    if (units.length && units.every(Number.isFinite) && Number.isFinite(property.no_of_units)
        && units.reduce((a,b)=>a+b,0) !== property.no_of_units) {
      throw new Error('Subject unit-mix rows do not reconcile with the reported unit count; inspect source rows before filling');
    }
  }
  for (const [target, source] of Object.entries({name: 'propertyName', address: 'street', city: 'city', state: 'stateAbbr', zip_code: 'zipCode'})) {
    if (address[source]) property[target] = address[source];
  }
  return {
    ...transformed,
    source: 'docling_full_sections',
    source_sha256: sections.subject_property?.metadata?.source_sha256,
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
