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

/** Conservative identity projection over retained Subject Property evidence. */
class AddressExtractor {
  extractFromSubjectProperty(data) {
    const result = {street:null,city:null,state:null,stateAbbr:null,zipCode:null,propertyName:null,fullAddress:null,confidence:0,sources:[]};
    if (!data) return result;
    const lines = [];
    for (const page of data.pages || []) {
      for (const item of [...(page.headers || []), ...(page.text_items || [])]) lines.push(...String(item.text || '').split(/\r?\n/));
    }
    lines.push(...String(data.raw_text || '').split(/\r?\n/));
    const streetPattern = /^(\d+[\w-]*\s+.+?\b(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Way|Lane|Ln|Court|Ct|Place|Pl|Circle|Cir|Parkway|Pkwy|Highway|Hwy)\b\.?(?:\s+[NESW]{1,2}\b)?)(?:\s+[-–—]\s+(.+))?$/i;
    for (const value of lines) {
      const text = value.trim().replace(/\s+/g, ' ');
      const street = text.match(streetPattern);
      if (street && !result.street) {result.street=street[1];result.sources.push('subject:street');}
      if (street?.[2] && !result.propertyName) {result.propertyName=street[2];result.sources.push('subject:property-name');}
      const cover = text.match(/^(.+?)\s+\d[\d,]*\s+Unit\s+Apartment\s+Building\b/i);
      if (cover && !result.propertyName) {result.propertyName=cover[1];result.sources.push('subject:cover-name');}
      // Docling may merge the cover's property name, unit count, and city into one item.
      const location = text.replace(/^.*?\b\d[\d,]*\s+Unit\s+Apartment\s+Building\s+/i, '');
      const match = location.match(/^([\p{L} .’'-]+),\s*([\p{L} ]+?)(?:\s+(\d{5}(?:-\d{4})?))?(?:\s+[-–—]\s+.*)?$/u);
      if (match) {
        const state = match[2].trim();
        const stateAbbr = STATE_ABBREVIATIONS[state.toLowerCase()] || (Object.values(STATE_ABBREVIATIONS).includes(state.toUpperCase()) ? state.toUpperCase() : null);
        if (stateAbbr && !result.city) {
          result.city=match[1].trim();result.state=state;result.stateAbbr=stateAbbr;result.sources.push('subject:city-state');
          if (match[3]) {result.zipCode=match[3];result.sources.push('subject:address-zip');}
        }
      }
      const labeledZip = text.match(/^\s*(?:ZIP(?: Code)?|Postal Code)\s*:?\s*(\d{5}(?:-\d{4})?)\s*$/i);
      if (labeledZip && !result.zipCode) {result.zipCode=labeledZip[1];result.sources.push('subject:labeled-zip');}
    }
    // A number is a ZIP only when its field explicitly identifies it as one.
    for (const table of data.tables || []) for (const row of table.rows || []) {
      for (const [key,value] of Object.entries(row)) {
        if (/^(?:zip(?: code)?|postal code)$/i.test(key.trim()) && /^\d{5}(?:-\d{4})?$/.test(String(value).trim()) && !result.zipCode) {
          result.zipCode=String(value).trim();result.sources.push('table:labeled-zip');
        }
      }
    }
    result.fullAddress=[result.street,result.city,result.stateAbbr,result.zipCode].filter(Boolean).join(', ') || null;
    result.confidence=(result.street?30:0)+(result.city?25:0)+(result.stateAbbr?25:0)+(result.zipCode?20:0);
    return result;
  }
  extractFromAllSections(sections) {
    // Other geographic sections must never establish subject identity.
    return this.extractFromSubjectProperty(sections.subject_property);
  }
  async lookupZipCode() {return null;}
}
export {AddressExtractor, STATE_ABBREVIATIONS};
