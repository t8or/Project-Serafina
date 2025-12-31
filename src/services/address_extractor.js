/**
 * Address Extractor Service
 * 
 * Parses property address components from Docling-extracted CoStar JSON data.
 * Extracts: street address, city, state, zip code, and property name.
 */

// State name to abbreviation mapping
const STATE_ABBREVIATIONS = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
};

/**
 * AddressExtractor - Extracts address components from CoStar JSON data
 */
class AddressExtractor {
  constructor() {
    // Regex patterns for address extraction
    this.patterns = {
      // Pattern: "123 Main St" or "123 Main St NE" etc.
      streetAddress: /^(\d+\s+[\w\s]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Way|Ln|Lane|Ct|Court|Pl|Place|Cir|Circle)\.?(?:\s+[NESW]{1,2})?)/i,
      // Pattern: "City, State - Neighborhood"
      cityState: /^([A-Za-z\s]+),\s*([A-Za-z\s]+)\s*[-–]/,
      // Pattern: "City, State"
      cityStateSimple: /^([A-Za-z\s]+),\s*([A-Za-z\s]+)$/,
      // Pattern for zip code (5 digits or 5+4)
      zipCode: /\b(\d{5}(?:-\d{4})?)\b/,
      // Pattern: "Address - Property Name"
      addressPropertyName: /^([\d\w\s]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Way|Ln|Lane|Ct|Court|Pl|Place|Cir|Circle)\.?(?:\s+[NESW]{1,2})?)\s*[-–]\s*(.+)$/i,
    };
  }

  /**
   * Extract address from subject_property JSON data.
   * 
   * @param {Object} subjectPropertyData - The subject_property section JSON
   * @returns {Object} Extracted address components
   */
  extractFromSubjectProperty(subjectPropertyData) {
    const result = {
      street: null,
      city: null,
      state: null,
      stateAbbr: null,
      zipCode: null,
      propertyName: null,
      fullAddress: null,
      confidence: 0,
      sources: [],
    };

    if (!subjectPropertyData) {
      return result;
    }

    // Strategy 1: Extract from headers
    this._extractFromHeaders(subjectPropertyData, result);

    // Strategy 2: Extract from text_items
    this._extractFromTextItems(subjectPropertyData, result);

    // Strategy 3: Extract from raw_text
    if (subjectPropertyData.raw_text) {
      this._extractFromRawText(subjectPropertyData.raw_text, result);
    }

    // Strategy 4: Try to find zip code in tables
    this._extractZipFromTables(subjectPropertyData, result);

    // Build full address string
    this._buildFullAddress(result);

    // Calculate confidence score
    this._calculateConfidence(result);

    return result;
  }

  /**
   * Extract address components from headers.
   * 
   * @param {Object} data - Subject property data
   * @param {Object} result - Result object to populate
   */
  _extractFromHeaders(data, result) {
    if (!data.pages) return;

    for (const page of data.pages) {
      if (!page.headers) continue;

      for (const header of page.headers) {
        const text = header.text?.trim();
        if (!text) continue;

        // Skip generic headers
        if (['SUBJECT PROPERTY', 'Subject Property', 'PREPARED BY'].includes(text)) {
          continue;
        }

        // Check for "Street Address - Property Name" pattern
        const addressNameMatch = text.match(this.patterns.addressPropertyName);
        if (addressNameMatch) {
          if (!result.street) {
            result.street = addressNameMatch[1].trim();
            result.sources.push('header:address-name');
          }
          if (!result.propertyName) {
            result.propertyName = addressNameMatch[2].trim();
            result.sources.push('header:property-name');
          }
          continue;
        }

        // Check for standalone street address
        const streetMatch = text.match(this.patterns.streetAddress);
        if (streetMatch && !result.street) {
          result.street = streetMatch[1].trim();
          result.sources.push('header:street');
        }
      }
    }
  }

  /**
   * Extract address components from text items.
   * 
   * @param {Object} data - Subject property data
   * @param {Object} result - Result object to populate
   */
  _extractFromTextItems(data, result) {
    if (!data.pages) return;

    for (const page of data.pages) {
      if (!page.text_items) continue;

      for (const item of page.text_items) {
        const text = item.text?.trim();
        if (!text) continue;

        // Check for "City, State - Neighborhood" pattern
        const cityStateMatch = text.match(this.patterns.cityState);
        if (cityStateMatch) {
          if (!result.city) {
            result.city = cityStateMatch[1].trim();
            result.sources.push('text:city');
          }
          if (!result.state) {
            const stateName = cityStateMatch[2].trim().toLowerCase();
            result.state = cityStateMatch[2].trim();
            result.stateAbbr = STATE_ABBREVIATIONS[stateName] || stateName.substring(0, 2).toUpperCase();
            result.sources.push('text:state');
          }
          continue;
        }

        // Check for simple "City, State" pattern
        const cityStateSimpleMatch = text.match(this.patterns.cityStateSimple);
        if (cityStateSimpleMatch && !result.city) {
          result.city = cityStateSimpleMatch[1].trim();
          const stateName = cityStateSimpleMatch[2].trim().toLowerCase();
          result.state = cityStateSimpleMatch[2].trim();
          result.stateAbbr = STATE_ABBREVIATIONS[stateName] || stateName.substring(0, 2).toUpperCase();
          result.sources.push('text:city-state-simple');
        }

        // Check for zip code
        const zipMatch = text.match(this.patterns.zipCode);
        if (zipMatch && !result.zipCode) {
          result.zipCode = zipMatch[1];
          result.sources.push('text:zip');
        }
      }
    }
  }

  /**
   * Extract from raw text content.
   * 
   * @param {string} rawText - Raw text from document
   * @param {Object} result - Result object to populate
   */
  _extractFromRawText(rawText, result) {
    const lines = rawText.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const text = line.trim();

      // Look for property name with unit count
      // Pattern: "Property Name XXX Unit Apartment Building City, State"
      const propertyMatch = text.match(/^(.+?)\s+(\d+)\s+Unit\s+(?:Apartment|Building)/i);
      if (propertyMatch && !result.propertyName) {
        result.propertyName = propertyMatch[1].trim();
        result.sources.push('raw:property-name');
      }

      // Look for city, state pattern in same line
      const cityStateMatch = text.match(this.patterns.cityState);
      if (cityStateMatch) {
        if (!result.city) {
          result.city = cityStateMatch[1].trim();
          result.sources.push('raw:city');
        }
        if (!result.state) {
          const stateName = cityStateMatch[2].trim().toLowerCase();
          result.state = cityStateMatch[2].trim();
          result.stateAbbr = STATE_ABBREVIATIONS[stateName] || stateName.substring(0, 2).toUpperCase();
          result.sources.push('raw:state');
        }
      }
    }
  }

  /**
   * Try to extract zip code from table data.
   * 
   * @param {Object} data - Subject property data
   * @param {Object} result - Result object to populate
   */
  _extractZipFromTables(data, result) {
    if (!data.tables || result.zipCode) return;

    for (const table of data.tables) {
      if (!table.rows) continue;

      for (const row of table.rows) {
        const values = Object.values(row);
        for (const value of values) {
          if (typeof value === 'string') {
            const zipMatch = value.match(this.patterns.zipCode);
            if (zipMatch) {
              result.zipCode = zipMatch[1];
              result.sources.push('table:zip');
              return;
            }
          }
        }
      }
    }
  }

  /**
   * Build full address string from components.
   * 
   * @param {Object} result - Result object with address components
   */
  _buildFullAddress(result) {
    const parts = [];
    
    if (result.street) parts.push(result.street);
    if (result.city) parts.push(result.city);
    if (result.stateAbbr) parts.push(result.stateAbbr);
    if (result.zipCode) parts.push(result.zipCode);

    result.fullAddress = parts.length > 0 ? parts.join(', ') : null;
  }

  /**
   * Calculate confidence score based on extracted components.
   * 
   * @param {Object} result - Result object with address components
   */
  _calculateConfidence(result) {
    let score = 0;
    
    if (result.street) score += 30;
    if (result.city) score += 25;
    if (result.stateAbbr) score += 25;
    if (result.zipCode) score += 20;
    
    result.confidence = score;
  }

  /**
   * Extract address from full Docling output (all section files).
   * 
   * @param {Object} sectionFiles - Object containing all section JSON data
   * @returns {Object} Extracted address components
   */
  extractFromAllSections(sectionFiles) {
    // Primary: subject_property
    if (sectionFiles.subject_property) {
      const result = this.extractFromSubjectProperty(sectionFiles.subject_property);
      if (result.confidence >= 50) {
        return result;
      }
    }

    // Fallback: demographics section might have location info
    if (sectionFiles.demographics) {
      const demoResult = this._extractFromDemographics(sectionFiles.demographics);
      if (demoResult.confidence > 0) {
        return demoResult;
      }
    }

    // Return empty result if nothing found
    return {
      street: null,
      city: null,
      state: null,
      stateAbbr: null,
      zipCode: null,
      propertyName: null,
      fullAddress: null,
      confidence: 0,
      sources: [],
    };
  }

  /**
   * Extract location info from demographics section.
   * 
   * @param {Object} demographicsData - Demographics section JSON
   * @returns {Object} Extracted address components
   */
  _extractFromDemographics(demographicsData) {
    const result = {
      street: null,
      city: null,
      state: null,
      stateAbbr: null,
      zipCode: null,
      propertyName: null,
      fullAddress: null,
      confidence: 0,
      sources: [],
    };

    // Demographics often has city/state in headers or tables
    if (demographicsData.raw_text) {
      this._extractFromRawText(demographicsData.raw_text, result);
    }

    this._buildFullAddress(result);
    this._calculateConfidence(result);

    return result;
  }

  /**
   * Look up zip code using city and state (placeholder for future API integration).
   * For now, returns null - would integrate with USPS or similar API.
   * 
   * @param {string} city - City name
   * @param {string} stateAbbr - State abbreviation
   * @returns {Promise<string|null>} Zip code or null
   */
  async lookupZipCode(city, stateAbbr) {
    // Placeholder for future zip code lookup API
    // Could use USPS, Google Geocoding, etc.
    console.log(`[AddressExtractor] Zip lookup not implemented: ${city}, ${stateAbbr}`);
    return null;
  }
}

export { AddressExtractor, STATE_ABBREVIATIONS };

