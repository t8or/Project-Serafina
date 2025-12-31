/**
 * GreatSchools School Ratings Scraper
 * 
 * Extracts school ratings from GreatSchools.org for a given address.
 * Data includes assigned elementary and high school names and ratings.
 */

// State abbreviation to full name mapping for URL construction
const STATE_NAMES_FULL = {
  'AL': 'alabama', 'AK': 'alaska', 'AZ': 'arizona', 'AR': 'arkansas',
  'CA': 'california', 'CO': 'colorado', 'CT': 'connecticut', 'DE': 'delaware',
  'FL': 'florida', 'GA': 'georgia', 'HI': 'hawaii', 'ID': 'idaho',
  'IL': 'illinois', 'IN': 'indiana', 'IA': 'iowa', 'KS': 'kansas',
  'KY': 'kentucky', 'LA': 'louisiana', 'ME': 'maine', 'MD': 'maryland',
  'MA': 'massachusetts', 'MI': 'michigan', 'MN': 'minnesota', 'MS': 'mississippi',
  'MO': 'missouri', 'MT': 'montana', 'NE': 'nebraska', 'NV': 'nevada',
  'NH': 'new-hampshire', 'NJ': 'new-jersey', 'NM': 'new-mexico', 'NY': 'new-york',
  'NC': 'north-carolina', 'ND': 'north-dakota', 'OH': 'ohio', 'OK': 'oklahoma',
  'OR': 'oregon', 'PA': 'pennsylvania', 'RI': 'rhode-island', 'SC': 'south-carolina',
  'SD': 'south-dakota', 'TN': 'tennessee', 'TX': 'texas', 'UT': 'utah',
  'VT': 'vermont', 'VA': 'virginia', 'WA': 'washington', 'WV': 'west-virginia',
  'WI': 'wisconsin', 'WY': 'wyoming', 'DC': 'district-of-columbia',
};

/**
 * GreatSchoolsScraper - Extracts school ratings from GreatSchools.org
 * 
 * Target: Search by address to find nearby/assigned schools
 * 
 * Extracted data:
 * - elementary_school_name: Name of assigned elementary school
 * - elementary_school_rating: Rating (1-10)
 * - high_school_name: Name of assigned high school
 * - high_school_rating: Rating (1-10)
 */
class GreatSchoolsScraper {
  constructor(config = {}) {
    this.config = config;
    this.baseUrl = 'https://www.greatschools.org';
  }

  /**
   * Build the search URL for finding schools near an address.
   * 
   * @param {string} city - City name
   * @param {string} state - Two-letter state code
   * @returns {string} Search URL
   */
  buildSearchUrl(city, state) {
    const stateName = STATE_NAMES_FULL[state.toUpperCase()];
    if (!stateName) {
      throw new Error(`Invalid state code: ${state}`);
    }
    // Format city for URL (lowercase, hyphens)
    const cityFormatted = city.toLowerCase().replace(/\s+/g, '-');
    return `${this.baseUrl}/${stateName}/${cityFormatted}/schools/`;
  }

  /**
   * Scrape school data from GreatSchools.org.
   * 
   * @param {Page} page - Playwright page instance
   * @param {string} address - Street address
   * @param {string} city - City name
   * @param {string} state - Two-letter state code
   * @param {string} zipCode - 5-digit zip code
   * @returns {Promise<Object>} School data with ratings
   */
  async scrape(page, address, city, state, zipCode) {
    console.log(`[GreatSchools] Scraping schools for: ${address}, ${city}, ${state} ${zipCode}`);

    try {
      // Strategy 1: Try direct search URL first
      const searchUrl = this.buildSearchUrl(city, state);
      console.log(`[GreatSchools] Navigating to: ${searchUrl}`);

      const response = await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      if (!response || response.status() !== 200) {
        console.log(`[GreatSchools] Direct URL failed, trying search page`);
        return await this.scrapeViaSearch(page, address, city, state, zipCode);
      }

      // Wait for content to load
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
        console.log('[GreatSchools] Network idle timeout - proceeding');
      });

      // Try to use the address search on the page
      const schoolData = await this.extractSchoolsFromPage(page, address);

      // If no schools found from listing, try the search
      if (!schoolData.elementary && !schoolData.high) {
        console.log('[GreatSchools] No schools from listing, trying address search');
        return await this.scrapeViaSearch(page, address, city, state, zipCode);
      }

      // Calculate average rating from available schools
      const averageRating = this.calculateAverageRating(schoolData);

      return {
        success: true,
        data: {
          ...schoolData,
          average_rating: averageRating,
          source: 'GreatSchools.org',
          url: searchUrl,
          scraped_at: new Date().toISOString(),
        },
      };

    } catch (error) {
      console.error('[GreatSchools] Scraping error:', error.message);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  /**
   * Scrape schools using the address search functionality.
   * 
   * @param {Page} page - Playwright page instance
   * @param {string} address - Street address
   * @param {string} city - City name
   * @param {string} state - Two-letter state code
   * @param {string} zipCode - 5-digit zip code
   * @returns {Promise<Object>} School data
   */
  async scrapeViaSearch(page, address, city, state, zipCode) {
    try {
      // Go to main GreatSchools page with search
      const searchPageUrl = `${this.baseUrl}/school-district-boundaries-map/`;
      console.log(`[GreatSchools] Navigating to search: ${searchPageUrl}`);

      await page.goto(searchPageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Look for address search input
      const fullAddress = `${address}, ${city}, ${state} ${zipCode}`;
      
      // Try multiple selectors for the search input
      const searchSelectors = [
        'input[placeholder*="address"]',
        'input[placeholder*="Address"]',
        'input[name*="address"]',
        'input[type="search"]',
        '#search-input',
        '.search-input',
        'input.pac-target-input',
        '[data-testid="address-input"]',
      ];

      let searchInput = null;
      for (const selector of searchSelectors) {
        try {
          searchInput = await page.$(selector);
          if (searchInput) {
            console.log(`[GreatSchools] Found search input: ${selector}`);
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      if (searchInput) {
        // Enter the address
        await searchInput.click();
        await searchInput.fill(fullAddress);
        await page.waitForTimeout(1000);
        
        // Press Enter or click search button
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);

        // Extract schools from search results
        const schoolData = await this.extractSchoolsFromPage(page, address);
        const averageRating = this.calculateAverageRating(schoolData);
        
        return {
          success: schoolData.elementary !== null || schoolData.high !== null,
          data: {
            ...schoolData,
            average_rating: averageRating,
            source: 'GreatSchools.org',
            search_address: fullAddress,
            scraped_at: new Date().toISOString(),
          },
        };
      }

      // If no search input found, try to extract from general listing
      console.log('[GreatSchools] No search input found, extracting from page');
      const schoolData = await this.extractSchoolsFromPage(page, address);
      const averageRating = this.calculateAverageRating(schoolData);

      return {
        success: schoolData.elementary !== null || schoolData.high !== null,
        data: {
          ...schoolData,
          average_rating: averageRating,
          source: 'GreatSchools.org',
          scraped_at: new Date().toISOString(),
        },
      };

    } catch (error) {
      console.error('[GreatSchools] Search scraping error:', error.message);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  /**
   * Extract school information from the current page.
   * 
   * @param {Page} page - Playwright page instance
   * @param {string} address - Original address for context
   * @returns {Promise<Object>} Extracted school data
   */
  async extractSchoolsFromPage(page) {
    const result = {
      elementary: null,
      middle: null,
      high: null,
    };

    try {
      // Extract school cards/listings from the page
      const schools = await page.evaluate(() => {
        const schoolList = [];
        
        // Look for school cards with various selectors
        const cardSelectors = [
          '[class*="school-card"]',
          '[class*="SchoolCard"]',
          '[data-testid*="school"]',
          '.school-list-item',
          '.school-result',
          'article[class*="school"]',
          '[class*="school-listing"]',
          'li[class*="school"]',
        ];

        for (const selector of cardSelectors) {
          const cards = document.querySelectorAll(selector);
          cards.forEach(card => {
            // Extract school name
            const nameEl = card.querySelector('h1, h2, h3, h4, [class*="name"], [class*="title"], a[href*="/school/"]');
            const name = nameEl?.textContent?.trim();
            
            // Extract rating (usually 1-10 scale on GreatSchools)
            const ratingEl = card.querySelector(
              '[class*="rating"], [class*="Rating"], [class*="score"], [class*="Score"], ' +
              '[data-rating], .circle-rating, [class*="circle"]'
            );
            let rating = null;
            
            if (ratingEl) {
              // Try data attribute first
              rating = ratingEl.getAttribute('data-rating') || 
                       ratingEl.getAttribute('data-score');
              
              // Try text content
              if (!rating) {
                const ratingText = ratingEl.textContent || '';
                const ratingMatch = ratingText.match(/(\d+)\s*\/\s*10/) || 
                                   ratingText.match(/^(\d+)$/);
                if (ratingMatch) rating = ratingMatch[1];
              }
              
              // Try aria-label
              if (!rating) {
                const ariaLabel = ratingEl.getAttribute('aria-label') || '';
                const ariaMatch = ariaLabel.match(/(\d+)/);
                if (ariaMatch) rating = ariaMatch[1];
              }
            }
            
            // Determine school type from text/class
            const cardText = card.textContent?.toLowerCase() || '';
            const cardClass = card.className?.toLowerCase() || '';
            
            let type = 'unknown';
            if (cardText.includes('elementary') || cardClass.includes('elementary')) {
              type = 'elementary';
            } else if (cardText.includes('middle') || cardClass.includes('middle')) {
              type = 'middle';
            } else if (cardText.includes('high') || cardClass.includes('high')) {
              type = 'high';
            } else if (cardText.includes('k-5') || cardText.includes('k-6')) {
              type = 'elementary';
            } else if (cardText.includes('6-8') || cardText.includes('7-8')) {
              type = 'middle';
            } else if (cardText.includes('9-12') || cardText.includes('high school')) {
              type = 'high';
            }

            // Extract grades served
            const gradesEl = card.querySelector('[class*="grade"], [class*="Grade"]');
            const grades = gradesEl?.textContent?.trim();

            if (name) {
              schoolList.push({
                name,
                rating: rating ? parseInt(rating, 10) : null,
                type,
                grades,
              });
            }
          });

          if (schoolList.length > 0) break;
        }

        // If no cards found, try to extract from tables
        if (schoolList.length === 0) {
          const tables = document.querySelectorAll('table');
          tables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
              const cells = row.querySelectorAll('td');
              if (cells.length >= 2) {
                const name = cells[0]?.textContent?.trim();
                const ratingText = cells[1]?.textContent?.trim();
                const ratingMatch = ratingText?.match(/(\d+)/);
                
                if (name && ratingMatch) {
                  const rowText = row.textContent?.toLowerCase() || '';
                  let type = 'unknown';
                  if (rowText.includes('elementary')) type = 'elementary';
                  else if (rowText.includes('middle')) type = 'middle';
                  else if (rowText.includes('high')) type = 'high';
                  
                  schoolList.push({
                    name,
                    rating: parseInt(ratingMatch[1], 10),
                    type,
                  });
                }
              }
            });
          });
        }

        return schoolList;
      });

      console.log(`[GreatSchools] Found ${schools.length} schools on page`);

      // Categorize schools by type
      for (const school of schools) {
        if (school.type === 'elementary' && !result.elementary) {
          result.elementary = {
            name: school.name,
            rating: school.rating,
            grades: school.grades,
          };
        } else if (school.type === 'middle' && !result.middle) {
          result.middle = {
            name: school.name,
            rating: school.rating,
            grades: school.grades,
          };
        } else if (school.type === 'high' && !result.high) {
          result.high = {
            name: school.name,
            rating: school.rating,
            grades: school.grades,
          };
        }
      }

      // If we didn't categorize any, use first available schools by type heuristics
      if (!result.elementary && !result.high && schools.length > 0) {
        // Sort by grade level (elementary first, then high)
        const elementary = schools.find(s => 
          s.name.toLowerCase().includes('elementary') ||
          s.grades?.includes('K') ||
          s.grades?.includes('1-') ||
          s.grades?.includes('-5')
        );
        const high = schools.find(s => 
          s.name.toLowerCase().includes('high') ||
          s.grades?.includes('9-') ||
          s.grades?.includes('-12')
        );

        if (elementary) {
          result.elementary = {
            name: elementary.name,
            rating: elementary.rating,
            grades: elementary.grades,
          };
        }
        if (high) {
          result.high = {
            name: high.name,
            rating: high.rating,
            grades: high.grades,
          };
        }
      }

    } catch (error) {
      console.error('[GreatSchools] Extraction error:', error.message);
    }

    return result;
  }

  /**
   * Calculate average rating from elementary and high school ratings.
   * Per user requirements: only use elementary and high school for final report.
   * 
   * @param {Object} schoolData - School data with elementary, middle, high
   * @returns {number|null} Average rating or null if no ratings
   */
  calculateAverageRating(schoolData) {
    const ratings = [];
    
    // Primary: elementary and high (per user requirement)
    if (schoolData.elementary?.rating) {
      ratings.push(schoolData.elementary.rating);
    }
    if (schoolData.high?.rating) {
      ratings.push(schoolData.high.rating);
    }
    
    // If no elementary or high, use middle as fallback
    if (ratings.length === 0 && schoolData.middle?.rating) {
      ratings.push(schoolData.middle.rating);
    }
    
    if (ratings.length === 0) {
      return null;
    }
    
    const average = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
    return Math.round(average * 10) / 10; // Round to 1 decimal
  }
}

export { GreatSchoolsScraper, STATE_NAMES_FULL };

