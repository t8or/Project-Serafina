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
  
  const lines = markdown.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  
  // Parse header row (first line with |)
  const headerLine = lines.find(l => l.includes('|') && !l.match(/^\|[\s-:|]+\|$/));
  if (!headerLine) return [];
  
  const headers = headerLine.split('|')
    .map(h => h.trim())
    .filter(h => h && !h.match(/^-+$/));
  
  const rows = [];
  
  // Parse data rows
  for (const line of lines) {
    if (line.match(/^\|[\s-:|]+\|$/) || line === headerLine) continue;
    if (!line.includes('|')) continue;
    
    const cells = line.split('|').map(c => c.trim()).filter((c, i) => i > 0 && i <= headers.length);
    
    if (cells.length > 0) {
      const row = {};
      headers.forEach((h, i) => {
        row[h] = cells[i] || '';
      });
      rows.push(row);
    }
  }
  
  return rows;
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
              if (key.toLowerCase().includes(columnName.toLowerCase())) {
                return value;
              }
            }
          }
          // If no column match, return second value (often the data column)
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
            if (columnName && key.toLowerCase().includes(columnName.toLowerCase())) {
              return value;
            }
          }
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
  if (!value) return null;
  const str = String(value).replace(/[$,]/g, '').trim();
  
  if (str === '-' || str === '') return null;
  
  const match = str.match(/([-\d.]+)%?/);
  if (match) {
    const num = parseFloat(match[1]);
    // If it's a percentage value, divide by 100
    if (isPercentage || str.includes('%')) {
      return num / 100;
    }
    return num;
  }
  return null;
}

/**
 * Extract demographics data from Docling sections.
 * The 3-mile demographics are typically in the submarket_report section.
 */
export function extractDemographicsFromDocling(demographicsSection, submarketSection) {
  const result = {};
  
  // Collect all tables from both sections
  const allTables = [];
  
  if (submarketSection) {
    // Tables in the submarket section often have 3-mile demographics
    if (submarketSection.tables) {
      allTables.push(...submarketSection.tables);
    }
    // Also check pages for tables
    const pages = submarketSection.pages || [];
    for (const page of pages) {
      if (page.tables) allTables.push(...page.tables);
    }
  }
  
  if (demographicsSection) {
    if (demographicsSection.tables) {
      allTables.push(...demographicsSection.tables);
    }
    const pages = demographicsSection.pages || [];
    for (const page of pages) {
      if (page.tables) allTables.push(...page.tables);
    }
  }
  
  // Look for 3-mile demographics in tables
  // Format: Row label | 1 Mile | 3 Mile | ...
  // Also check for "3 Mile" as a row key in structured table data
  
  // First check if there's structured table data with "3 Mile" column
  for (const table of allTables) {
    if (table.rows) {
      for (const row of table.rows) {
        const rowLabel = Object.values(row)[0] || '';
        const threeValue = row['3 Mile'];
        
        if (threeValue && threeValue !== '') {
          const label = String(rowLabel).toLowerCase();
          
          if (label.includes('2024 population') || label === 'population') {
            const val = parseNumericValue(threeValue);
            if (val && val > 1000) result.population_3mile = val; // Sanity check
          }
          if (label.includes('pop growth') || label.includes('population growth') || label.includes('household growth')) {
            result.population_growth_3mile = parseNumericValue(threeValue, true);
          }
          if (label.includes('median household income') || label.includes('median hh income')) {
            result.median_hh_income_3mile = parseNumericValue(threeValue);
          }
          if (label.includes('median home value')) {
            result.median_home_value_3mile = parseNumericValue(threeValue);
          }
          if (label.includes('renter')) {
            result.renter_households_pct_3mile = parseNumericValue(threeValue, true);
          }
        }
      }
    }
  }
  
  // Fallback to markdown table parsing if not found
  if (!result.population_3mile) {
    const pop = findTableValue(allTables, '2024 Population', '3 Mile');
    if (pop) result.population_3mile = parseNumericValue(pop);
  }
  
  if (!result.population_growth_3mile) {
    const popGrowth = findTableValue(allTables, 'Pop Growth', '3 Mile') ||
                      findTableValue(allTables, 'Population Growth', '3 Mile') ||
                      findTableValue(allTables, 'Household Growth', '3 Mile');
    if (popGrowth) result.population_growth_3mile = parseNumericValue(popGrowth, true);
  }
  
  if (!result.median_hh_income_3mile) {
    const income = findTableValue(allTables, 'Median Household Income', '3 Mile') ||
                   findTableValue(allTables, 'Median HH Income', '3 Mile');
    if (income) result.median_hh_income_3mile = parseNumericValue(income);
  }
  
  if (!result.median_home_value_3mile) {
    const homeValue = findTableValue(allTables, 'Median Home Value', '3 Mile');
    if (homeValue) result.median_home_value_3mile = parseNumericValue(homeValue);
  }
  
  // Renter households percentage - often needs to be looked up separately
  if (!result.renter_households_pct_3mile) {
    const renterPct = findTableValue(allTables, 'Renter', '3 Mile') ||
                      findTableValue(allTables, 'Renter Occupied', '3 Mile') ||
                      findTableValue(allTables, 'Renter Households', '3 Mile');
    if (renterPct) result.renter_households_pct_3mile = parseNumericValue(renterPct, true);
  }
  
  // If not found in tables, search text for demographics
  const allText = [];
  if (demographicsSection?.pages) {
    for (const page of demographicsSection.pages) {
      for (const item of (page.text_items || [])) {
        allText.push(item.text || '');
      }
    }
  }
  
  const combinedText = allText.join(' ');
  
  // Try to extract from text if not found in tables
  if (!result.renter_households_pct_3mile) {
    // Look for patterns like "60% of households now rent" or "renter: 48%"
    const renterMatch = combinedText.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:households?\s+)?(?:now\s+)?rent/i) ||
                        combinedText.match(/rent(?:er|al)?[:\s]+(\d+(?:\.\d+)?)\s*%/i);
    if (renterMatch) {
      result.renter_households_pct_3mile = parseFloat(renterMatch[1]) / 100;
    }
  }
  
  console.log('[CoStarExtract] Extracted demographics:', result);
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
