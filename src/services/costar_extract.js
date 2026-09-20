/**
 * CoStarExtract — deep module for Docling/CoStar section parsing.
 *
 * Interface: SECTION_TYPES + extract*FromDocling helpers.
 * Callers assemble PropertyData; this module only parses section JSON.
 */

export const SECTION_TYPES = [
  'subject_property', 'demographics', 'rent_comps', 'construction',
  'sale_comps', 'submarket_report', 'market_report', 'unknown', 'external'
];

/**
 * Parse markdown table string into rows of data.
 * Returns array of objects with column headers as keys.
 */
export function parseMarkdownTable(markdown) {
  if (!markdown) return [];
  const split = line => {
    const cells = line.trim().split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
    if (cells[0] === '') cells.shift();
    if (cells.at(-1) === '') cells.pop();
    return cells;
  };
  const lines = markdown.split('\n').filter(line => line.includes('|') && line.trim());
  if (lines.length < 2) return [];
  const rawHeaders = split(lines[0]);
  const headers = rawHeaders.map((header, i) => header && rawHeaders.indexOf(header) === rawHeaders.lastIndexOf(header) ? header : `${header || 'column'} [${i + 1}]`);
  return lines.slice(1).filter(line => !/^[|\s:-]+$/.test(line)).flatMap(line => {
    const cells = split(line);
    return cells.length === headers.length ? [Object.fromEntries(headers.map((header, i) => [header, cells[i]]))] : [];
  });
}

/**
 * Find value in a table by row label and column name.
 * More precise matching - requires exact column name match if provided.
 */
export function findTableValue(tables, rowLabel, columnName) {
  for (const table of tables) {
    if (table.markdown) {
      const rows = parseMarkdownTable(table.markdown);
      for (const row of rows) {
        const rowKeys = Object.keys(row);
        const rowValues = Object.values(row);
        const firstCell = rowValues[0] || '';
        
        // Check if first cell matches the row label
        if (String(firstCell).toLowerCase().includes(rowLabel.toLowerCase())) {
          // If columnName specified, find that exact column
          if (columnName) {
            for (const [key, value] of Object.entries(row)) {
              if (key.toLowerCase().trim() === columnName.toLowerCase().trim()) {
                return value;
              }
            }
            // Try partial match on column name
            for (const [key, value] of Object.entries(row)) {
              if (key.toLowerCase().trim().replace(/miles$/, 'mile') === columnName.toLowerCase().trim().replace(/miles$/, 'mile')) {
                return value;
              }
            }
          }
          if (columnName) continue;
          // Without a requested column, use the second value.
          if (rowValues.length > 1) {
            return rowValues[1];
          }
        }
      }
    }
    
    // Also check rows array if present
    if (table.rows) {
      for (const row of table.rows) {
        // Check if any value in the row matches the row label
        const rowValues = Object.values(row);
        const firstValue = rowValues[0] || '';
        
        if (String(firstValue).toLowerCase().includes(rowLabel.toLowerCase())) {
          // If columnName specified, look for that column
          if (columnName && row[columnName] !== undefined) {
            return row[columnName];
          }
          // Try case-insensitive column match
          for (const [key, value] of Object.entries(row)) {
            if (columnName && key.toLowerCase().trim().replace(/miles$/, 'mile') === columnName.toLowerCase().trim().replace(/miles$/, 'mile')) {
              return value;
            }
          }
          if (columnName) continue;
          // Return first numeric-looking value after the label
          for (let i = 1; i < rowValues.length; i++) {
            if (String(rowValues[i]).match(/[\d$%]/)) {
              return rowValues[i];
            }
          }
        }
      }
    }
  }
  return null;
}

/**
 * Parse a numeric value from various formats ($123,456 or 12.5% or 123,456)
 */
export function parseNumericValue(value, isPercentage = false) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  let str = String(value).trim().replace(/−/g, '-');
  const percent = isPercentage || str.includes('%');
  str = str.replace(/%$/, '');
  if (/^\(.*\)$/.test(str)) str = '-' + str.slice(1, -1).replace(/%$/, '');
  str = str.replace(/\$/g, '');
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(str)) return null;
  const num = Number(str.replace(/,/g, ''));
  return Number.isFinite(num) ? num / (percent ? 100 : 1) : null;
}

/**
 * Extract demographics data from Docling sections.
 * The 3-mile demographics are typically in the submarket_report section.
 */
export function extractDemographicsFromDocling(demographicsSection, submarketSection, radius = 3) {
  const tables = [demographicsSection, submarketSection].filter(Boolean).flatMap(section => [
    ...(section.tables || []), ...(section.pages || []).flatMap(page => page.tables || []),
  ]);
  const candidates = [];
  for (const table of tables) {
    const rows = table.rows || parseMarkdownTable(table.markdown);
    for (const row of rows) {
      const columns = Object.keys(row).filter(key => new RegExp(`^${radius}[ -]*miles?$`, 'i').test(key.trim()));
      if (columns.length !== 1) continue;
      const label = String(Object.values(row)[0] || '').trim();
      let field, percentage = false, period = null;
      if (/^(?:\d{4} )?population$/i.test(label)) {
        field = 'population_3mile'; period = label.match(/\d{4}/)?.[0];
      } else if (/^pop(?:ulation)? growth\b/i.test(label)) {
        field = 'population_growth_3mile'; percentage = true;
      } else if (/^median (?:household|hh) income$/i.test(label)) field = 'median_hh_income_3mile';
      else if (/^median home value$/i.test(label)) field = 'median_home_value_3mile';
      else if (/^renter(?: occupied| households)?(?: %| percent| percentage)?$/i.test(label) && String(row[columns[0]]).includes('%')) {
        field = 'renter_households_pct_3mile'; percentage = true;
      }
      if (!field) continue;
      const value = parseNumericValue(row[columns[0]], percentage);
      if (value !== null) candidates.push({field: field.replace('_3mile', `_${radius}mile`), value, period, label});
    }
  }
  const years = candidates.filter(c => c.field === `population_${radius}mile` && c.period).map(c => Number(c.period));
  const baseline = years.length ? Math.min(...years) : null;
  const grouped = {};
  for (const candidate of candidates) {
    if (candidate.field === `population_${radius}mile` && candidate.period && Number(candidate.period) !== baseline) continue;
    (grouped[candidate.field] ||= []).push(candidate);
  }
  const result = {};
  for (const [field, values] of Object.entries(grouped)) {
    if (new Set(values.map(v => v.value)).size === 1) result[field] = values[0].value;
    else (result.__conflicts ||= {})[field] = values;
  }
  return result;
}

/**
 * Extract submarket analytics data from Docling sections.
 * Looks for the "Current Quarter" table with "Submarket" row.
 * NOTE: This table can be in construction, demographics, OR submarket_report sections.
 * 
 * Key table format:
 * | Current Quarter | Units  | Vacancy Rate | ... | Delivered Units | Under Constr Units |
 * | Submarket       | 31,741 | 8.6%         | ... | 0               | 507                |
 * | Delivered Units | 1,086  | ...          |     |                 |                    |
 * 
 * Delivered % = 12 Month Delivered Units (from "Delivered Units" row) / Total Units
 * Construction % = Under Constr Units (from "Submarket" row) / Total Units
 */
export function extractSubmarketFromDocling(submarketSection, constructionSection, demographicsSection = null) {
  const result = {};
  
  // Collect all tables from ALL relevant sections (demographics often has the key data)
  const allTables = [];
  const allText = [];
  
  // Include demographics section - it often contains the submarket metrics table
  for (const section of [constructionSection, submarketSection, demographicsSection]) {
    if (!section) continue;
    
    if (section.tables) {
      allTables.push(...section.tables);
    }
    
    const pages = section.pages || [];
    for (const page of pages) {
      if (page.tables) allTables.push(...page.tables);
      for (const item of (page.text_items || [])) {
        allText.push(item.text || '');
      }
    }
  }
  
  console.log(`[CoStarExtract] Submarket extraction: found ${allTables.length} tables`);
  
  // First, try to find vacancy from text
  const combinedText = allText.join(' ');
  const vacMatch = combinedText.match(/(?:submarket['s]?\s+)?vacancy\s+(?:rate\s+)?(?:of\s+|has\s+\w+\s+to\s+|is\s+|at\s+)?(\d+(?:\.\d+)?)\s*%/i);
  if (vacMatch) {
    result.vacancy_rate = parseFloat(vacMatch[1]) / 100;
    console.log(`[CoStarExtract] Found vacancy from text: ${vacMatch[1]}%`);
  }
  
  // Track data from the "Current Quarter" table
  let submarketTotalUnits = null;
  let submarketUnderConstr = null;
  let twelveMonthDelivered = null;
  
  // Strategy: Find the table with "Current Quarter" column
  // This table has "Submarket" row (totals) and "Delivered Units" row (12-month)
  for (const table of allTables) {
    if (!table.rows) continue;
    
    const tableHeaders = table.headers || (table.rows[0] ? Object.keys(table.rows[0]) : []);
    
    // Check if headers is an array of strings or objects with 'text' property
    const headerTexts = Array.isArray(tableHeaders) && tableHeaders[0]?.text 
      ? tableHeaders.map(h => h.text || h) 
      : tableHeaders;
    
    if (!headerTexts.includes('Current Quarter')) continue;
    
    for (const row of table.rows) {
      const currentQuarter = row['Current Quarter'] || '';
      
      // "Submarket" row has total units, vacancy, and under construction
      if (currentQuarter === 'Submarket' || currentQuarter.toLowerCase() === 'submarket') {
        submarketTotalUnits = parseNumericValue(row['Units']);
        submarketUnderConstr = parseNumericValue(row['Under Constr Units']);
        const vacancyRate = parseNumericValue(row['Vacancy Rate'], true);
        
        console.log('[CoStarExtract] Found Submarket row:', { 
          totalUnits: submarketTotalUnits, 
          underConstr: submarketUnderConstr, 
          vacancy: vacancyRate 
        });
        
        if (!result.vacancy_rate && vacancyRate) {
          result.vacancy_rate = vacancyRate;
        }
      }
      
      // "Delivered Units" row has 12-month delivered (in the "Units" column)
      if (currentQuarter === 'Delivered Units') {
        twelveMonthDelivered = parseNumericValue(row['Units']);
        console.log('[CoStarExtract] Found 12-month Delivered Units:', twelveMonthDelivered);
      }
    }
    
    // If we found submarket data in this table, calculate percentages
    if (submarketTotalUnits && submarketTotalUnits > 0) {
      // Delivered % = 12 Month Delivered / Total Units
      if (twelveMonthDelivered !== null) {
        result.delivered_pct_of_inventory = twelveMonthDelivered / submarketTotalUnits;
        console.log(`[CoStarExtract] Delivered %: ${twelveMonthDelivered}/${submarketTotalUnits} = ${(result.delivered_pct_of_inventory * 100).toFixed(2)}%`);
      }
      
      // Construction % = Under Construction / Total Units
      if (submarketUnderConstr !== null) {
        result.construction_pct_of_inventory = submarketUnderConstr / submarketTotalUnits;
        console.log(`[CoStarExtract] Construction %: ${submarketUnderConstr}/${submarketTotalUnits} = ${(result.construction_pct_of_inventory * 100).toFixed(2)}%`);
      }
      
      break; // Found our data, stop searching
    }
  }
  
  // Fallback: Look for "Percent of Inventory" in table with Under Construction summary
  if (result.construction_pct_of_inventory === undefined) {
    for (const table of allTables) {
      if (!table.rows) continue;
      
      for (const row of table.rows) {
        const pctOfInv = row['Percent of Inventory'];
        if (pctOfInv) {
          // This is likely the under construction summary
          result.construction_pct_of_inventory = parseNumericValue(pctOfInv, true);
          console.log(`[CoStarExtract] Found Construction % from Percent of Inventory: ${pctOfInv}`);
          break;
        }
      }
      if (result.construction_pct_of_inventory !== undefined) break;
    }
  }
  
  // If not found in text, try table lookup with specific column
  if (!result.vacancy_rate) {
    const vacancyFromTable = findTableValue(allTables, 'Submarket', 'Vacancy Rate');
    if (vacancyFromTable) {
      result.vacancy_rate = parseNumericValue(vacancyFromTable, true);
    }
  }
  
  console.log('[CoStarExtract] Extracted submarket data:', result);
  return result;
}

/**
 * Extract property-specific metrics (Walk Score, Transit Score) from subject_property.
 */
export function extractPropertyMetricsFromDocling(subjectPropertySection) {
  if (!subjectPropertySection) return {};
  
  const result = {};
  
  // Collect all text and tables
  const allText = [];
  const allTables = [];
  
  if (subjectPropertySection.tables) {
    allTables.push(...subjectPropertySection.tables);
  }
  
  const pages = subjectPropertySection.pages || [];
  for (const page of pages) {
    if (page.tables) allTables.push(...page.tables);
    for (const item of (page.text_items || [])) {
      allText.push(item.text || '');
    }
  }
  
  // Look for Walk Score and Transit Score in tables
  const walkScore = findTableValue(allTables, 'Walk Score', '');
  if (walkScore) {
    const parsed = parseNumericValue(walkScore);
    if (parsed !== null) result.walk_score = parsed;
  }
  
  const transitScore = findTableValue(allTables, 'Transit Score', '');
  if (transitScore) {
    const parsed = parseNumericValue(transitScore);
    if (parsed !== null) result.transit_score = parsed;
  }
  
  // Try text patterns if not found in tables
  const combinedText = allText.join(' ');
  
  if (!result.walk_score) {
    const walkMatch = combinedText.match(/walk\s*score[:\s]+(\d+)/i);
    if (walkMatch) result.walk_score = parseInt(walkMatch[1]);
  }
  
  if (!result.transit_score) {
    const transitMatch = combinedText.match(/transit\s*score[:\s]+(\d+)/i);
    if (transitMatch) result.transit_score = parseInt(transitMatch[1]);
  }
  
  
  console.log('[CoStarExtract] Extracted property metrics:', result);
  return result;
}
