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
   * IMPORTANT: We need to find ASSIGNED schools for the specific address, not just any schools in the city.
   * 
   * User-confirmed approach: Go to homepage, enter full address in search box, it auto-selects assigned schools.
   * 
   * @param {Page} page - Playwright page instance
   * @param {string} address - Street address
   * @param {string} city - City name
   * @param {string} state - Two-letter state code
   * @param {string} zipCode - 5-digit zip code
   * @returns {Promise<Object>} School data with ratings
   */
  async scrape(page, address, city, state, zipCode) {
    const fullAddress = `${address}, ${city}, ${state}${zipCode ? ' ' + zipCode : ''}`;
    console.log(`[GreatSchools] Scraping ASSIGNED schools for: ${fullAddress}`);

    try {
      // Primary Strategy: Go to homepage and search with full address
      // This is the user-confirmed working approach
      const homepageResult = await this.scrapeViaHomepageSearch(page, fullAddress);
      if (homepageResult.success && (homepageResult.data?.elementary?.rating || homepageResult.data?.high?.rating)) {
        console.log('[GreatSchools] Found assigned schools via homepage search');
        return homepageResult;
      }

      // Fallback: Try the boundary map
      console.log('[GreatSchools] Homepage search failed, trying boundary map');
      const boundaryResult = await this.scrapeViaBoundaryMap(page, address, city, state, zipCode);
      if (boundaryResult.success && boundaryResult.data?.elementary?.rating) {
        return boundaryResult;
      }

      // Last resort: City listing (not ideal - returns generic schools)
      console.log('[GreatSchools] Falling back to city listing');
      const searchUrl = this.buildSearchUrl(city, state);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      
      const schoolData = await this.extractSchoolsFromPage(page, address);
      const averageRating = this.calculateAverageRating(schoolData);

      return {
        success: schoolData.elementary !== null || schoolData.high !== null,
        data: {
          ...schoolData,
          average_rating: averageRating,
          source: 'GreatSchools.org',
          url: searchUrl,
          method: 'city_listing_fallback',
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
   * Scrape via GreatSchools homepage search - USER CONFIRMED WORKING APPROACH
   * Go to homepage, enter full address in the search box, get assigned schools.
   */
  async scrapeViaHomepageSearch(page, fullAddress) {
    try {
      console.log(`[GreatSchools] Navigating to homepage for address search`);
      
      // Go to GreatSchools homepage - use 'domcontentloaded' since 'networkidle' times out
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log(`[GreatSchools] Homepage loaded, URL: ${page.url()}`);
      await page.waitForTimeout(3000); // Give time for JS to initialize
      
      const pageTitle = await page.title();
      console.log(`[GreatSchools] Page title: ${pageTitle}`);

      // Step 1: Click the search-box-input on homepage to open the search modal
      console.log('[GreatSchools] Looking for .search-box-input to open modal...');
      let searchBoxInput = await page.$('.search-box-input');
      
      if (!searchBoxInput) {
        console.log('[GreatSchools] ERROR: Could not find .search-box-input on homepage');
        return { success: false, error: 'Could not find .search-box-input on homepage', data: null };
      }
      
      console.log('[GreatSchools] Clicking .search-box-input to open modal...');
      await searchBoxInput.click();
      await page.waitForTimeout(2000); // Wait for modal to open
      
      // Step 2: Find and click the ADDRESS input (#where-js with placeholder "Address, city, or zip")
      console.log('[GreatSchools] Looking for address input #where-js...');
      const addressInput = await page.$('#where-js');
      
      if (!addressInput) {
        console.log('[GreatSchools] ERROR: Could not find #where-js address input');
        return { success: false, error: 'Could not find address input #where-js', data: null };
      }
      
      console.log('[GreatSchools] Found address input, clicking to focus...');
      await addressInput.click();
      await page.waitForTimeout(500);
      
      // Step 3: Type the address
      console.log(`[GreatSchools] Typing address: ${fullAddress}`);
      await page.keyboard.type(fullAddress, { delay: 50 });
      console.log('[GreatSchools] Address typed, waiting for Google autocomplete...');
      await page.waitForTimeout(2000);
      
      // Step 4: Click the top Google autocomplete suggestion
      console.log('[GreatSchools] Looking for Google autocomplete suggestion...');
      const autocompleteSelectors = [
        '.pac-item:first-child',  // Google Places autocomplete
        '.pac-container .pac-item',
        '[class*="pac-item"]',
      ];
      
      let suggestionClicked = false;
      for (const selector of autocompleteSelectors) {
        const suggestion = await page.$(selector);
        if (suggestion) {
          const visible = await suggestion.isVisible().catch(() => false);
          if (visible) {
            console.log(`[GreatSchools] Found autocomplete suggestion: ${selector}, clicking...`);
            await suggestion.click();
            suggestionClicked = true;
            break;
          }
        }
      }
      
      if (!suggestionClicked) {
        console.log('[GreatSchools] No autocomplete suggestion found, continuing anyway...');
      }
      
      await page.waitForTimeout(1000);
      
      // Step 5: Click the school type dropdown to open it, then select "Public"
      console.log('[GreatSchools] Looking for school type dropdown (.input-field.what)...');
      
      // First, click the dropdown to open it
      const schoolTypeDropdown = await page.$('.input-field.what');
      if (schoolTypeDropdown) {
        console.log('[GreatSchools] Found school type dropdown, clicking to open...');
        await schoolTypeDropdown.click();
        await page.waitForTimeout(1000); // Wait for dropdown to open
      } else {
        console.log('[GreatSchools] Could not find school type dropdown, looking for alternative...');
      }
      
      // Now click the "Public" option in the dropdown
      console.log('[GreatSchools] Looking for Public option in dropdown (li[value="public"])...');
      
      let publicClicked = false;
      
      // Wait for the dropdown item to be visible and click it using page.click for reliability
      try {
        await page.waitForSelector('li.search-results-list-item-new[value="public"]', { 
          state: 'visible', 
          timeout: 5000 
        });
        console.log('[GreatSchools] Found Public option, clicking with force...');
        // Use page.click with force to ensure the click happens
        await page.click('li.search-results-list-item-new[value="public"]', { force: true });
        publicClicked = true;
        console.log('[GreatSchools] Public option clicked successfully');
      } catch (e) {
        console.log('[GreatSchools] Could not click li[value="public"]:', e.message);
      }
      
      if (!publicClicked) {
        // Try alternative selectors
        const publicButtonSelectors = [
          'li[value="public"]',
          '.search-results-list-item-new[value="public"]',
          'button:has-text("Public")',
          'a:has-text("Public schools")',
        ];
        
        for (const selector of publicButtonSelectors) {
          try {
            const publicBtn = await page.$(selector);
            if (publicBtn) {
              const visible = await publicBtn.isVisible().catch(() => false);
              if (visible) {
                const text = await publicBtn.textContent();
                console.log(`[GreatSchools] Found Public button: ${selector}, text="${text?.trim().substring(0, 50)}", clicking...`);
                await publicBtn.click();
                publicClicked = true;
                break;
              }
            }
          } catch (e) {
            // Continue to next selector
          }
        }
      }
      
      if (!publicClicked) {
        console.log('[GreatSchools] Could not find Public schools button, pressing Enter...');
        await page.keyboard.press('Enter');
      }
      
      console.log('[GreatSchools] Search initiated');

      // Wait for results page to load
      console.log('[GreatSchools] Waiting for results page to load...');
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(4000); // Give time for school cards to render
      
      // Log the final URL and page content summary
      const finalUrl = page.url();
      const finalTitle = await page.title();
      console.log(`[GreatSchools] Results page URL: ${finalUrl}`);
      console.log(`[GreatSchools] Results page title: ${finalTitle}`);
      
      // Check if we have results - look for .school-list container
      const schoolList = await page.$('.school-list');
      if (!schoolList) {
        console.log('[GreatSchools] No .school-list found - checking if still on homepage');
        if (finalUrl === this.baseUrl || finalUrl === `${this.baseUrl}/`) {
          console.log('[GreatSchools] Still on homepage - search may have failed');
          return { success: false, error: 'Search did not navigate to results page', data: null };
        }
      } else {
        console.log('[GreatSchools] Found .school-list container - results loaded');
      }

      // Extract assigned schools from the results (look for "Assigned school in" text)
      const schoolData = await this.extractAssignedSchoolsFromResults(page);
      const averageRating = this.calculateAverageRating(schoolData);

      console.log('[GreatSchools] Extracted school data:', schoolData);

      return {
        success: schoolData.elementary !== null || schoolData.high !== null,
        data: {
          ...schoolData,
          average_rating: averageRating,
          source: 'GreatSchools.org',
          url: page.url(),
          method: 'homepage_search',
          search_address: fullAddress,
          scraped_at: new Date().toISOString(),
        },
      };

    } catch (error) {
      console.error('[GreatSchools] Homepage search error:', error.message);
      return { success: false, error: error.message, data: null };
    }
  }

  /**
   * Scrape using GreatSchools' School District Boundaries Map feature.
   * This finds the actual ASSIGNED schools for an address.
   */
  async scrapeViaBoundaryMap(page, address, city, state, zipCode) {
    try {
      const boundaryUrl = `${this.baseUrl}/school-district-boundaries-map/`;
      console.log(`[GreatSchools] Navigating to boundary map: ${boundaryUrl}`);

      await page.goto(boundaryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Full address for search
      const fullAddress = `${address}, ${city}, ${state} ${zipCode || ''}`.trim();
      
      // Look for the address search input on the boundary map page
      const searchSelectors = [
        'input.pac-target-input',
        'input[placeholder*="Enter"]',
        'input[placeholder*="address"]',
        'input[placeholder*="Address"]',
        '#search-box-input',
        '.search-box input',
        'input[type="text"]',
      ];

      let searchInput = null;
      for (const selector of searchSelectors) {
        searchInput = await page.$(selector);
        if (searchInput) {
          const visible = await searchInput.isVisible().catch(() => false);
          if (visible) {
            console.log(`[GreatSchools] Found boundary search input: ${selector}`);
            break;
          }
          searchInput = null;
        }
      }

      if (searchInput) {
        await searchInput.click();
        await searchInput.fill(fullAddress);
        await page.waitForTimeout(1500);
        
        // Wait for autocomplete suggestions
        const suggestionSelector = '.pac-container .pac-item, .autocomplete-suggestion';
        try {
          await page.waitForSelector(suggestionSelector, { timeout: 3000 });
          const firstSuggestion = await page.$(suggestionSelector);
          if (firstSuggestion) {
            await firstSuggestion.click();
          } else {
            await page.keyboard.press('Enter');
          }
        } catch {
          await page.keyboard.press('Enter');
        }
        
        await page.waitForTimeout(3000);

        // Extract assigned schools from boundary results
        const schoolData = await this.extractAssignedSchools(page);
        const averageRating = this.calculateAverageRating(schoolData);

        return {
          success: schoolData.elementary !== null || schoolData.high !== null,
          data: {
            ...schoolData,
            average_rating: averageRating,
            source: 'GreatSchools.org',
            method: 'boundary_map',
            search_address: fullAddress,
            scraped_at: new Date().toISOString(),
          },
        };
      }

      return { success: false, error: 'No search input found on boundary map', data: null };

    } catch (error) {
      console.error('[GreatSchools] Boundary map error:', error.message);
      return { success: false, error: error.message, data: null };
    }
  }

  /**
   * Search for nearby schools using GreatSchools' search feature.
   */
  async scrapeViaNearbySearch(page, address, city, state, zipCode) {
    try {
      // Try the find-schools-near-you page
      const searchUrl = `${this.baseUrl}/find-schools/?searchType=byAddress`;
      console.log(`[GreatSchools] Navigating to nearby search: ${searchUrl}`);

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const fullAddress = `${address}, ${city}, ${state} ${zipCode || ''}`.trim();

      // Look for address input
      const searchInput = await page.$('input[name="address"], input[placeholder*="address"], input[type="search"]');
      
      if (searchInput) {
        await searchInput.click();
        await searchInput.fill(fullAddress);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);

        const schoolData = await this.extractAssignedSchools(page);
        const averageRating = this.calculateAverageRating(schoolData);

        return {
          success: schoolData.elementary !== null || schoolData.high !== null,
          data: {
            ...schoolData,
            average_rating: averageRating,
            source: 'GreatSchools.org',
            method: 'nearby_search',
            search_address: fullAddress,
            scraped_at: new Date().toISOString(),
          },
        };
      }

      return { success: false, error: 'No nearby search input found', data: null };

    } catch (error) {
      console.error('[GreatSchools] Nearby search error:', error.message);
      return { success: false, error: error.message, data: null };
    }
  }

  /**
   * Extract assigned schools from search results page.
   * Uses specific GreatSchools class names:
   * - class="assigned-tag" identifies assigned schools
   * - class="circle-rating--search-page circle-rating--X" where X is the rating (1-10)
   */
  async extractAssignedSchoolsFromResults(page) {
    const result = {
      elementary: null,
      middle: null,
      high: null,
    };

    try {
      // Look for school cards in .school-list that have the "assigned-tag" class
      const schools = await page.evaluate(() => {
        const assignedSchools = [];
        
        // Find the school-list container first
        const schoolList = document.querySelector('.school-list');
        if (!schoolList) {
          console.log('No .school-list container found');
          return assignedSchools;
        }
        
        // Find all elements with class="assigned-tag" within school-list
        const assignedTags = schoolList.querySelectorAll('.assigned-tag');
        console.log(`Found ${assignedTags.length} assigned-tag elements in .school-list`);
        
        for (const assignedTag of assignedTags) {
          // Walk up to find the parent school card/container
          let card = assignedTag.parentElement;
          for (let i = 0; i < 15 && card; i++) {
            // Look for a container that has school info
            if (card.querySelector('.circle-rating--search-page') || 
                card.querySelector('a[href*="/school/"]') ||
                card.classList?.contains('school-card')) {
              break;
            }
            card = card.parentElement;
          }
          
          if (!card) {
            console.log('Could not find parent card for assigned-tag');
            continue;
          }
          
          // Extract school name from the card
          const nameEl = card.querySelector('a[href*="/school/"]') || 
                         card.querySelector('h2, h3, h4') ||
                         card.querySelector('[class*="name"]');
          const name = nameEl?.textContent?.trim();
          
          // Extract rating from class="circle-rating--search-page circle-rating--X"
          let rating = null;
          const ratingEl = card.querySelector('[class*="circle-rating--"]');
          if (ratingEl) {
            const classList = ratingEl.className;
            // Look for "circle-rating--X" pattern where X is the number
            const ratingMatch = classList.match(/circle-rating--(\d+)/);
            if (ratingMatch) {
              rating = parseInt(ratingMatch[1], 10);
            }
          }
          
          // Determine school type from card text and assigned-tag text
          const cardText = card.textContent.toLowerCase();
          const assignedText = assignedTag.textContent.toLowerCase();
          let type = 'unknown';
          
          // Check assigned-tag text first (more reliable - contains district name)
          if (assignedText.includes('elementary')) {
            type = 'elementary';
          } else if (assignedText.includes('high school') || assignedText.includes('union high')) {
            type = 'high';
          } else if (assignedText.includes('middle')) {
            type = 'middle';
          }
          
          // Fallback to card text
          if (type === 'unknown') {
            if (cardText.includes('elementary school') || cardText.includes('pre-k')) {
              type = 'elementary';
            } else if (cardText.includes('high school')) {
              type = 'high';
            } else if (cardText.includes('middle school')) {
              type = 'middle';
            }
          }
          
          if (name && name.length > 2) {
            assignedSchools.push({ 
              name, 
              rating, 
              type, 
              assignedText: assignedTag.textContent.trim(),
              ratingClass: ratingEl?.className || 'not found'
            });
          }
        }
        
        return assignedSchools;
      });

      console.log(`[GreatSchools] Found ${schools.length} assigned schools:`, JSON.stringify(schools));

      // Categorize by type
      for (const school of schools) {
        if (school.type === 'elementary' && !result.elementary) {
          result.elementary = { name: school.name, rating: school.rating };
          console.log(`[GreatSchools] Elementary: ${school.name} (rating: ${school.rating})`);
        } else if (school.type === 'middle' && !result.middle) {
          result.middle = { name: school.name, rating: school.rating };
          console.log(`[GreatSchools] Middle: ${school.name} (rating: ${school.rating})`);
        } else if (school.type === 'high' && !result.high) {
          result.high = { name: school.name, rating: school.rating };
          console.log(`[GreatSchools] High: ${school.name} (rating: ${school.rating})`);
        }
      }

      // If we couldn't categorize, use heuristics on names
      if (!result.elementary && !result.high) {
        for (const school of schools) {
          const nameLower = school.name.toLowerCase();
          if (!result.elementary && nameLower.includes('elementary')) {
            result.elementary = { name: school.name, rating: school.rating };
          } else if (!result.high && (nameLower.includes('high') && !nameLower.includes('higher'))) {
            result.high = { name: school.name, rating: school.rating };
          }
        }
      }

    } catch (error) {
      console.error('[GreatSchools] Assigned schools extraction error:', error.message);
    }

    return result;
  }

  /**
   * Extract assigned schools from boundary/search results (legacy method).
   * These are the schools that the student at this address would be assigned to.
   */
  async extractAssignedSchools(page) {
    const result = {
      elementary: null,
      middle: null,
      high: null,
    };

    try {
      const schools = await page.evaluate(() => {
        const schoolList = [];
        
        // Look for "Assigned Schools" section or boundary results
        const assignedSelectors = [
          '[class*="assigned"]',
          '[class*="boundary"]',
          '[class*="district-school"]',
          '.school-boundary-result',
          '[data-testid*="assigned"]',
          '.schools-list li',
          '.school-card',
          '[class*="SchoolCard"]',
        ];

        for (const selector of assignedSelectors) {
          const cards = document.querySelectorAll(selector);
          if (cards.length > 0) {
            cards.forEach(card => {
              // Get school name
              const nameEl = card.querySelector('h2, h3, h4, a[href*="/school/"], [class*="name"], [class*="title"]');
              const name = nameEl?.textContent?.trim();
              
              // Get rating
              let rating = null;
              const ratingEl = card.querySelector('[class*="rating"], [class*="score"], .circle-rating, [class*="gs-rating"]');
              if (ratingEl) {
                const ratingText = ratingEl.textContent || '';
                const match = ratingText.match(/(\d+)/);
                if (match) rating = parseInt(match[1], 10);
                
                // Check data attributes
                if (!rating) {
                  rating = parseInt(ratingEl.getAttribute('data-rating') || ratingEl.getAttribute('data-score'), 10) || null;
                }
              }

              // Determine type by examining content
              const cardText = (card.textContent || '').toLowerCase();
              let type = 'unknown';
              
              if (cardText.includes('elementary') || cardText.match(/grades?\s*[pk]-?[0-6]/i)) {
                type = 'elementary';
              } else if (cardText.includes('middle') || cardText.match(/grades?\s*[5-8]-?[6-9]/i)) {
                type = 'middle';
              } else if (cardText.includes('high') || cardText.match(/grades?\s*9-?1[0-2]/i)) {
                type = 'high';
              }

              if (name && name.length > 3) {
                schoolList.push({ name, rating, type });
              }
            });
            
            if (schoolList.length > 0) break;
          }
        }

        return schoolList;
      });

      console.log(`[GreatSchools] Extracted ${schools.length} assigned schools`);

      // Assign to categories
      for (const school of schools) {
        if (school.type === 'elementary' && !result.elementary) {
          result.elementary = { name: school.name, rating: school.rating };
        } else if (school.type === 'middle' && !result.middle) {
          result.middle = { name: school.name, rating: school.rating };
        } else if (school.type === 'high' && !result.high) {
          result.high = { name: school.name, rating: school.rating };
        }
      }

      // If still no categorization, use name-based heuristics
      if (!result.elementary && !result.high) {
        for (const school of schools) {
          const nameLower = school.name.toLowerCase();
          if (!result.elementary && (nameLower.includes('elementary') || nameLower.includes('primary'))) {
            result.elementary = { name: school.name, rating: school.rating };
          } else if (!result.high && (nameLower.includes('high') || nameLower.includes('secondary'))) {
            result.high = { name: school.name, rating: school.rating };
          }
        }
      }

    } catch (error) {
      console.error('[GreatSchools] Assigned schools extraction error:', error.message);
    }

    return result;
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

