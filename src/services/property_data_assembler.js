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
import path from 'path';
import { ScoringService } from './scoring_service.js';
import {
  extractDemographicsFromDocling,
  extractSubmarketFromDocling,
  extractPropertyMetricsFromDocling,
} from './costar_extract.js';

export const SCORECARD_CONFIG_PATH = path.join(
  process.cwd(),
  'uploads',
  'config',
  'scorecard_config.json'
);

let scoringServiceInstance = null;
let configLoadPromise = null;

/**
 * Load uploads/config/scorecard_config.json into the singleton once.
 * Missing file → defaults (not an error).
 */
async function loadSavedConfigOnce(service) {
  try {
    const configData = await fs.readFile(SCORECARD_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(configData);
    service.updateConfig(config);
    console.log('[PropertyDataAssembler] Loaded saved scorecard configuration');
  } catch (error) {
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
  const demographics = extractDemographicsFromDocling(
    sections.demographics,
    sections.submarket_report
  );
  const submarket = extractSubmarketFromDocling(
    sections.submarket_report,
    sections.construction,
    sections.demographics
  );
  const property = extractPropertyMetricsFromDocling(sections.subject_property);

  return {
    address,
    demographics: demographics || {},
    property: property || {},
    submarket: submarket || {},
    external: external !== undefined ? external : (sections.external || {}),
  };
}
