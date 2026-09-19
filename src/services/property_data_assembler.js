/**
 * PropertyDataAssembler — deep module that turns Docling section maps into
 * the PropertyData shape ScoringService expects.
 *
 * Interface:
 *   assemblePropertyData(sections, address, external?)
 *   getScoringService() — singleton that loads saved scorecard config once
 *
 * Locality: all CoStar → PropertyData wiring lives here; HTTP handlers stay thin.
 */

import fs from 'fs/promises';
import { ScoringService } from './scoring_service.js';
import { SCORECARD_CONFIG_PATH } from '../config/runtime_paths.js';
import {
  extractDemographicsFromDocling,
  extractSubmarketFromDocling,
  extractPropertyMetricsFromDocling,
} from './costar_extract.js';

export { SCORECARD_CONFIG_PATH } from '../config/runtime_paths.js';

let scoringServiceInstance = null;
let configLoadPromise = null;

/**
 * Load the local application-data scorecard configuration into the singleton once.
 * Missing file → defaults (not an error).
 */
async function loadSavedConfigOnce(service) {
  try {
    const configData = await fs.readFile(SCORECARD_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(configData);
    service.updateConfig(config);
    console.log('[PropertyDataAssembler] Loaded saved scorecard configuration');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log('[PropertyDataAssembler] No saved configuration found, using defaults');
  }
}

/**
 * Shared ScoringService factory. Always the same instance; config load starts
 * on first call (await ensureScoringConfigLoaded() if you need config before score).
 */
export function getScoringService() {
  if (!scoringServiceInstance) {
    scoringServiceInstance = new ScoringService();
    configLoadPromise = loadSavedConfigOnce(scoringServiceInstance);
  }
  return scoringServiceInstance;
}

/**
 * Wait until saved config has been applied (or defaults confirmed).
 */
export function ensureScoringConfigLoaded() {
  getScoringService();
  return configLoadPromise || Promise.resolve();
}

/**
 * Assemble PropertyData for scoring from Docling section objects.
 *
 * @param {Object} sections - map of section_type → parsed JSON
 * @param {Object} address - address object (from AddressExtractor or DB)
 * @param {Object} [external] - optional override; else sections.external || {}
 * @returns {{ address, demographics, property, submarket, external }}
 */
export function assemblePropertyData(sections = {}, address = {}, external) {
  const referenceData = (external !== undefined ? external : sections.external) || {};
  const documentDemographics = extractDemographicsFromDocling(
    sections.demographics,
    sections.submarket_report
  );
  const documentSubmarket = extractSubmarketFromDocling(
    sections.submarket_report,
    sections.construction,
    sections.demographics
  );
  const nativeDemographics = sections.demographics?.scoring_metrics || {};
  const nativeSubmarket = sections.submarket_report?.scoring_metrics || {};
  const property = extractPropertyMetricsFromDocling(sections.subject_property);

  const clean = (values) => Object.fromEntries(Object.entries(values || {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)));
  const merge = (reference, parsed, native, conflicts) => {
    const result = { ...clean(reference), ...clean(parsed), ...clean(native) };
    for (const field of Object.keys(conflicts || {})) delete result[field];
    return result;
  };
  return {
    address,
    demographics: merge(referenceData.demographics, documentDemographics, nativeDemographics, {...documentDemographics.__conflicts, ...sections.demographics?.scoring_conflicts}),
    property: property || {},
    submarket: merge(referenceData.submarket, documentSubmarket, nativeSubmarket, sections.submarket_report?.scoring_conflicts),
    external: referenceData,
    coverage: sections.subject_property?.metadata?.coverage,
  };
}
