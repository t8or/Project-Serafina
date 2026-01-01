/**
 * US Census Bureau Regional Divisions
 * 
 * Maps US states to their Census regions for dashboard drill-down navigation.
 * Reference: https://www.census.gov/programs-surveys/geography/guidance/geo-identifiers.html
 */

// State abbreviation to region mapping
export const STATE_TO_REGION = {
  // Northeast
  CT: 'northeast', ME: 'northeast', MA: 'northeast', NH: 'northeast',
  NJ: 'northeast', NY: 'northeast', PA: 'northeast', RI: 'northeast', VT: 'northeast',
  
  // Midwest
  IL: 'midwest', IN: 'midwest', IA: 'midwest', KS: 'midwest',
  MI: 'midwest', MN: 'midwest', MO: 'midwest', NE: 'midwest',
  ND: 'midwest', OH: 'midwest', SD: 'midwest', WI: 'midwest',
  
  // South
  AL: 'south', AR: 'south', DE: 'south', FL: 'south', GA: 'south',
  KY: 'south', LA: 'south', MD: 'south', MS: 'south', NC: 'south',
  OK: 'south', SC: 'south', TN: 'south', TX: 'south', VA: 'south',
  WV: 'south', DC: 'south',
  
  // West
  AK: 'west', AZ: 'west', CA: 'west', CO: 'west', HI: 'west',
  ID: 'west', MT: 'west', NV: 'west', NM: 'west', OR: 'west',
  UT: 'west', WA: 'west', WY: 'west',
};

// Region metadata for display
export const REGIONS = {
  northeast: {
    key: 'northeast',
    name: 'Northeast',
    states: ['CT', 'ME', 'MA', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT'],
  },
  midwest: {
    key: 'midwest',
    name: 'Midwest',
    states: ['IL', 'IN', 'IA', 'KS', 'MI', 'MN', 'MO', 'NE', 'ND', 'OH', 'SD', 'WI'],
  },
  south: {
    key: 'south',
    name: 'South',
    states: ['AL', 'AR', 'DE', 'FL', 'GA', 'KY', 'LA', 'MD', 'MS', 'NC', 'OK', 'SC', 'TN', 'TX', 'VA', 'WV', 'DC'],
  },
  west: {
    key: 'west',
    name: 'West',
    states: ['AK', 'AZ', 'CA', 'CO', 'HI', 'ID', 'MT', 'NV', 'NM', 'OR', 'UT', 'WA', 'WY'],
  },
};

// Full state names for display
export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/**
 * Get region for a state abbreviation.
 * @param {string} stateAbbr - Two-letter state abbreviation (e.g., "CA")
 * @returns {string|null} - Region key or null if not found
 */
export function getRegionForState(stateAbbr) {
  if (!stateAbbr) return null;
  return STATE_TO_REGION[stateAbbr.toUpperCase()] || null;
}

/**
 * Get all states in a region.
 * @param {string} regionKey - Region key (e.g., "west")
 * @returns {string[]} - Array of state abbreviations
 */
export function getStatesInRegion(regionKey) {
  if (!regionKey) return [];
  const region = REGIONS[regionKey.toLowerCase()];
  return region ? region.states : [];
}

/**
 * Get full state name from abbreviation.
 * @param {string} stateAbbr - Two-letter state abbreviation
 * @returns {string} - Full state name or the abbreviation if not found
 */
export function getStateName(stateAbbr) {
  if (!stateAbbr) return '';
  return STATE_NAMES[stateAbbr.toUpperCase()] || stateAbbr;
}

/**
 * Get region display name.
 * @param {string} regionKey - Region key
 * @returns {string} - Region display name
 */
export function getRegionName(regionKey) {
  if (!regionKey) return '';
  const region = REGIONS[regionKey.toLowerCase()];
  return region ? region.name : regionKey;
}

