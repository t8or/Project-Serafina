/**
 * BestPlaces Crime Data Scraper
 * 
 * Extracts crime statistics from BestPlaces.net for a given zip code.
 * Data includes violent crime index, property crime index, and total crime index
 * compared against the national average (100 = national average).
 */

// State name mapping for URL construction
const STATE_NAMES = {
  'AL': 'alabama', 'AK': 'alaska', 'AZ': 'arizona', 'AR': 'arkansas',
  'CA': 'california', 'CO': 'colorado', 'CT': 'connecticut', 'DE': 'delaware',
  'FL': 'florida', 'GA': 'georgia', 'HI': 'hawaii', 'ID': 'idaho',
  'IL': 'illinois', 'IN': 'indiana', 'IA': 'iowa', 'KS': 'kansas',
  'KY': 'kentucky', 'LA': 'louisiana', 'ME': 'maine', 'MD': 'maryland',
  'MA': 'massachusetts', 'MI': 'michigan', 'MN': 'minnesota', 'MS': 'mississippi',
  'MO': 'missouri', 'MT': 'montana', 'NE': 'nebraska', 'NV': 'nevada',
  'NH': 'new_hampshire', 'NJ': 'new_jersey', 'NM': 'new_mexico', 'NY': 'new_york',
  'NC': 'north_carolina', 'ND': 'north_dakota', 'OH': 'ohio', 'OK': 'oklahoma',
  'OR': 'oregon', 'PA': 'pennsylvania', 'RI': 'rhode_island', 'SC': 'south_carolina',
  'SD': 'south_dakota', 'TN': 'tennessee', 'TX': 'texas', 'UT': 'utah',
  'VT': 'vermont', 'VA': 'virginia', 'WA': 'washington', 'WV': 'west_virginia',
  'WI': 'wisconsin', 'WY': 'wyoming', 'DC': 'district_of_columbia',
};

/**
 * BestPlacesScraper - Extracts crime data from BestPlaces.net
 * 
 * Target URL pattern: https://www.bestplaces.net/crime/zip-code/[state]/[zipcode]
 * 
 * Extracted data:
 * - violent_crime_index: Index where 100 = national average
 * - property_crime_index: Index where 100 = national average  
 * - total_crime_index: Overall crime index
 */
class BestPlacesScraper {
  constructor(config = {}) {
    this.config = config;
    this.baseUrl = 'https://www.bestplaces.net';
  }

  /**
   * Build the crime page URL for a given location.
   * Supports both zip code and city-based lookups.
   * 
   * @param {string} state - Two-letter state code
   * @param {string} zipCodeOrCity - 5-digit zip code or city name
   * @param {boolean} useCity - If true, use city-based URL instead of zip code
   * @returns {string} Full URL to the crime page
   */
  buildUrl(state, zipCodeOrCity, useCity = false) {
    const stateName = STATE_NAMES[state.toUpperCase()];
    if (!stateName) {
      throw new Error(`Invalid state code: ${state}`);
    }
    
    if (useCity) {
      // Format city name for URL: lowercase, underscores for spaces
      const cityForUrl = zipCodeOrCity.toLowerCase().replace(/\s+/g, '_');
      return `${this.baseUrl}/crime/city/${stateName}/${cityForUrl}`;
    }
    
    return `${this.baseUrl}/crime/zip-code/${stateName}/${zipCodeOrCity}`;
  }

  /**
   * Scrape crime data from BestPlaces.net.
   * Supports both zip code and city-based lookups.
   * 
   * @param {Page} page - Playwright page instance
   * @param {string} state - Two-letter state code
   * @param {string} zipCodeOrCity - 5-digit zip code or city name
   * @param {boolean} useCity - If true, use city-based URL instead of zip code
   * @returns {Promise<Object>} Crime data with indices
   */
  async scrape(page, state, zipCodeOrCity, useCity = false) {
    const url = this.buildUrl(state, zipCodeOrCity, useCity);
    console.log(`[BestPlaces] Navigating to: ${url}`);

    try {
      // Navigate to the crime page
      const response = await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Check for valid response
      if (!response || response.status() !== 200) {
        throw new Error(`Failed to load page: HTTP ${response?.status() || 'unknown'}`);
      }

      // Wait for the crime data card to load (much faster than networkidle)
      try {
        await page.waitForSelector('.card-body.m-3.p-0', { state: 'visible', timeout: 10000 });
        console.log('[BestPlaces] Crime data card loaded');
      } catch (e) {
        console.log('[BestPlaces] Card not found, proceeding anyway...');
      }

      // Extract crime indices from the page
      const crimeData = await this.extractCrimeData(page);

      console.log('[BestPlaces] Extracted crime data:', crimeData);

      return {
        success: true,
        data: {
          ...crimeData,
          source: 'BestPlaces.net',
          url: url,
          scraped_at: new Date().toISOString(),
        },
      };

    } catch (error) {
      console.error('[BestPlaces] Scraping error:', error.message);
      
      // Try to capture page content for debugging
      try {
        const pageContent = await page.content();
        console.log('[BestPlaces] Page content length:', pageContent.length);
      } catch (e) {
        // Ignore content capture errors
      }

      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  /**
   * Extract crime indices from the page content.
   * 
   * BestPlaces displays crime data in various formats:
   * - Crime indices table comparing to national average
   * - Visual bars/charts with ARIA labels
   * - Text descriptions
   * 
   * @param {Page} page - Playwright page instance
   * @returns {Promise<Object>} Extracted crime indices
   */
  async extractCrimeData(page) {
    // Try chart extraction first (most reliable on BestPlaces)
    let crimeData = await this.extractFromCharts(page);
    
    if (!crimeData.violent_crime_index && !crimeData.property_crime_index) {
      console.log('[BestPlaces] Chart extraction failed, trying table extraction');
      crimeData = await this.extractFromTable(page);
    }
    
    if (!crimeData.violent_crime_index && !crimeData.property_crime_index) {
      console.log('[BestPlaces] Table extraction failed, trying text extraction');
      crimeData = await this.extractFromText(page);
    }

    if (!crimeData.violent_crime_index && !crimeData.property_crime_index) {
      console.log('[BestPlaces] Text extraction failed, trying graph extraction');
      crimeData = await this.extractFromGraph(page);
    }

    return crimeData;
  }

  /**
   * Extract crime data from Highcharts interactive charts.
   * BestPlaces uses charts with ARIA labels like "Violent, 21.4. North Carolina State."
   * 
   * @param {Page} page - Playwright page instance
   * @returns {Promise<Object>} Crime indices
   */
  async extractFromCharts(page) {
    const result = {
      violent_crime_index: null,
      property_crime_index: null,
      total_crime_index: null,
    };

    try {
      // Extract from ARIA labels on chart elements
      const chartData = await page.evaluate(() => {
        const data = { violent: null, property: null };
        
        // Look for images/elements with ARIA names containing crime data
        // Pattern: "Violent, 21.4. North Carolina State." or similar
        const allElements = document.querySelectorAll('[aria-label], img[name], [role="img"]');
        
        allElements.forEach(el => {
          const name = el.getAttribute('aria-label') || el.getAttribute('name') || '';
          
          // Look for state-specific violent crime value (not USA)
          if (name.toLowerCase().includes('violent') && !name.toLowerCase().includes('usa') && !name.toLowerCase().includes('united states')) {
            const match = name.match(/violent[,\s]+(\d+(?:\.\d+)?)/i);
            if (match && !data.violent) {
              data.violent = parseFloat(match[1]);
            }
          }
          
          // Look for state-specific property crime value (not USA)
          if (name.toLowerCase().includes('property') && !name.toLowerCase().includes('usa') && !name.toLowerCase().includes('united states')) {
            const match = name.match(/property[,\s]+(\d+(?:\.\d+)?)/i);
            if (match && !data.property) {
              data.property = parseFloat(match[1]);
            }
          }
        });

        // Also try to find in "Crime by Location" section
        const crimeByLocationSection = document.querySelector('[aria-label*="bar series"]');
        if (crimeByLocationSection) {
          const bars = crimeByLocationSection.querySelectorAll('img[name]');
          bars.forEach(bar => {
            const name = bar.getAttribute('name') || '';
            if (name.includes('Violent') && !name.includes('United States')) {
              const match = name.match(/Violent[,\s]+(\d+(?:\.\d+)?)/);
              if (match) data.violent = parseFloat(match[1]);
            }
            if (name.includes('Property') && !name.includes('United States')) {
              const match = name.match(/Property[,\s]+(\d+(?:\.\d+)?)/);
              if (match) data.property = parseFloat(match[1]);
            }
          });
        }

        return data;
      });

      if (chartData.violent) {
        result.violent_crime_index = chartData.violent;
      }
      if (chartData.property) {
        result.property_crime_index = chartData.property;
      }

      // Calculate total as average if both are available
      if (result.violent_crime_index && result.property_crime_index) {
        result.total_crime_index = Math.round((result.violent_crime_index + result.property_crime_index) / 2 * 10) / 10;
      }

      console.log('[BestPlaces] Chart extraction result:', result);

    } catch (error) {
      console.error('[BestPlaces] Chart extraction error:', error.message);
    }

    return result;
  }

  /**
   * Extract crime data from the statistics table.
   * 
   * @param {Page} page - Playwright page instance
   * @returns {Promise<Object>} Crime indices
   */
  async extractFromTable(page) {
    const result = {
      violent_crime_index: null,
      property_crime_index: null,
      total_crime_index: null,
    };

    try {
      // Look for crime statistics in the page
      // BestPlaces typically shows crime indices in tables or data displays
      
      // Strategy 1: Look for explicit crime index values
      const pageText = await page.textContent('body');
      
      // Pattern: "Violent Crime: XX.X" or "Violent Crime Index: XX.X"
      const violentMatch = pageText.match(/Violent\s*(?:Crime)?[:\s]+(\d+(?:\.\d+)?)/i);
      const propertyMatch = pageText.match(/Property\s*(?:Crime)?[:\s]+(\d+(?:\.\d+)?)/i);
      const totalMatch = pageText.match(/(?:Total|Overall)\s*(?:Crime)?[:\s]+(\d+(?:\.\d+)?)/i);

      if (violentMatch) {
        result.violent_crime_index = parseFloat(violentMatch[1]);
      }
      if (propertyMatch) {
        result.property_crime_index = parseFloat(propertyMatch[1]);
      }
      if (totalMatch) {
        result.total_crime_index = parseFloat(totalMatch[1]);
      }

      // Strategy 2: Look for table cells with crime data
      const tableData = await page.evaluate(() => {
        const tables = document.querySelectorAll('table');
        const data = {};
        
        tables.forEach(table => {
          const rows = table.querySelectorAll('tr');
          rows.forEach(row => {
            const cells = row.querySelectorAll('td, th');
            if (cells.length >= 2) {
              const label = cells[0]?.textContent?.toLowerCase() || '';
              const value = cells[1]?.textContent || '';
              
              if (label.includes('violent')) {
                const num = value.match(/(\d+(?:\.\d+)?)/);
                if (num) data.violent = parseFloat(num[1]);
              }
              if (label.includes('property')) {
                const num = value.match(/(\d+(?:\.\d+)?)/);
                if (num) data.property = parseFloat(num[1]);
              }
              if (label.includes('total') || label.includes('overall')) {
                const num = value.match(/(\d+(?:\.\d+)?)/);
                if (num) data.total = parseFloat(num[1]);
              }
            }
          });
        });
        
        return data;
      });

      if (tableData.violent && !result.violent_crime_index) {
        result.violent_crime_index = tableData.violent;
      }
      if (tableData.property && !result.property_crime_index) {
        result.property_crime_index = tableData.property;
      }
      if (tableData.total && !result.total_crime_index) {
        result.total_crime_index = tableData.total;
      }

    } catch (error) {
      console.error('[BestPlaces] Table extraction error:', error.message);
    }

    return result;
  }

  /**
   * Extract crime data from text content using regex patterns.
   * 
   * @param {Page} page - Playwright page instance
   * @returns {Promise<Object>} Crime indices
   */
  async extractFromText(page) {
    const result = {
      violent_crime_index: null,
      property_crime_index: null,
      total_crime_index: null,
    };

    try {
      // Get all text content and look for crime-related numbers
      const content = await page.evaluate(() => {
        // Look for crime-related divs/sections
        const crimeSection = document.querySelector('[class*="crime"], [id*="crime"], .crime-data');
        if (crimeSection) {
          return crimeSection.textContent;
        }
        return document.body.textContent;
      });

      // BestPlaces format: "The [location] violent crime rate is XX.X"
      // Or: "XX.X (violent crime is XX% higher/lower than national average)"
      
      // Look for patterns like "XX.X violent crime"
      const patterns = [
        { type: 'violent', regex: /(\d+(?:\.\d+)?)\s*(?:violent|for violent)/i },
        { type: 'property', regex: /(\d+(?:\.\d+)?)\s*(?:property|for property)/i },
        { type: 'total', regex: /(\d+(?:\.\d+)?)\s*(?:total|overall|crime index)/i },
      ];

      for (const { type, regex } of patterns) {
        const match = content.match(regex);
        if (match) {
          result[`${type}_crime_index`] = parseFloat(match[1]);
        }
      }

      // Also try: "violent crime rate of XX.X"
      const altPatterns = [
        { type: 'violent', regex: /violent\s*crime\s*(?:rate|index)?\s*(?:of|is|:)?\s*(\d+(?:\.\d+)?)/i },
        { type: 'property', regex: /property\s*crime\s*(?:rate|index)?\s*(?:of|is|:)?\s*(\d+(?:\.\d+)?)/i },
      ];

      for (const { type, regex } of altPatterns) {
        if (!result[`${type}_crime_index`]) {
          const match = content.match(regex);
          if (match) {
            result[`${type}_crime_index`] = parseFloat(match[1]);
          }
        }
      }

    } catch (error) {
      console.error('[BestPlaces] Text extraction error:', error.message);
    }

    return result;
  }

  /**
   * Extract crime data from graphical elements (progress bars, etc.).
   * 
   * @param {Page} page - Playwright page instance
   * @returns {Promise<Object>} Crime indices
   */
  async extractFromGraph(page) {
    const result = {
      violent_crime_index: null,
      property_crime_index: null,
      total_crime_index: null,
    };

    try {
      // Look for data attributes on graphical elements
      const graphData = await page.evaluate(() => {
        const data = {};
        
        // Look for progress bars or meter elements
        const progressBars = document.querySelectorAll('[class*="progress"], [class*="meter"], [class*="bar"], [role="progressbar"]');
        
        progressBars.forEach(bar => {
          const ariaLabel = bar.getAttribute('aria-label') || '';
          const ariaValue = bar.getAttribute('aria-valuenow');
          const width = bar.style.width;
          const dataValue = bar.getAttribute('data-value') || bar.getAttribute('data-percent');
          
          let value = ariaValue || dataValue;
          if (!value && width) {
            const widthMatch = width.match(/(\d+(?:\.\d+)?)/);
            if (widthMatch) value = widthMatch[1];
          }
          
          if (value) {
            const numValue = parseFloat(value);
            if (ariaLabel.toLowerCase().includes('violent')) {
              data.violent = numValue;
            } else if (ariaLabel.toLowerCase().includes('property')) {
              data.property = numValue;
            }
          }
        });

        // Look for SVG elements with crime data
        const svgTexts = document.querySelectorAll('svg text, .chart-value, .graph-value');
        svgTexts.forEach(el => {
          const text = el.textContent || '';
          const parent = el.closest('[class*="violent"], [class*="property"], [data-type]');
          if (parent) {
            const num = text.match(/(\d+(?:\.\d+)?)/);
            if (num) {
              const type = parent.className.includes('violent') ? 'violent' : 
                          parent.className.includes('property') ? 'property' : null;
              if (type) data[type] = parseFloat(num[1]);
            }
          }
        });

        return data;
      });

      if (graphData.violent) result.violent_crime_index = graphData.violent;
      if (graphData.property) result.property_crime_index = graphData.property;

    } catch (error) {
      console.error('[BestPlaces] Graph extraction error:', error.message);
    }

    return result;
  }
}

export { BestPlacesScraper, STATE_NAMES };

