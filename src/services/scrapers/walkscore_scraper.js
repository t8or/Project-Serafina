/**
 * WalkScore.com Scraper
 * 
 * Extracts Walk Score, Transit Score, and Bike Score for a given address.
 * WalkScore rates locations 0-100 based on walkability, transit access, and bikeability.
 */

// State name mappings for URL construction
const STATE_NAMES = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
  'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
  'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
  'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New_Hampshire', 'NJ': 'New_Jersey', 'NM': 'New_Mexico', 'NY': 'New_York',
  'NC': 'North_Carolina', 'ND': 'North_Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
  'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode_Island', 'SC': 'South_Carolina',
  'SD': 'South_Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
  'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West_Virginia',
  'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District_of_Columbia'
};

class WalkScoreScraper {
  constructor(config = {}) {
    this.config = config;
    this.baseUrl = 'https://www.walkscore.com';
  }

  /**
   * Build the search URL for an address.
   * WalkScore URL format: /score/ADDRESS/lat/lng or search-based
   */
  buildSearchUrl(address, city, state) {
    // WalkScore uses a search-based approach
    const searchQuery = encodeURIComponent(`${address}, ${city}, ${state}`);
    return `${this.baseUrl}/score/${searchQuery}`;
  }

  /**
   * Main scrape function - extracts Walk Score, Transit Score, Bike Score.
   */
  async scrape(page, address, city, state, zipCode = null) {
    console.log(`[WalkScore] Scraping scores for: ${address}, ${city}, ${state}`);
    
    try {
      // Build address for URL - WalkScore prefers hyphenated format
      // Format: /score/123-Main-St-City-State-Zip
      const streetFormatted = address.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
      const cityFormatted = city.replace(/\s+/g, '-');
      const stateAbbr = state.length === 2 ? state : this.getStateAbbr(state);
      
      // Try direct address URL first (most reliable)
      const directUrl = zipCode
        ? `${this.baseUrl}/score/${streetFormatted}-${cityFormatted}-${stateAbbr}-${zipCode}`
        : `${this.baseUrl}/score/${streetFormatted}-${cityFormatted}-${stateAbbr}`;
      
      console.log(`[WalkScore] Trying direct URL: ${directUrl}`);
      
      await page.goto(directUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      
      // Handle cookie consent popup if present
      await this.dismissOverlays(page);
      
      // Wait for score elements to appear
      await page.waitForTimeout(3000);
      
      // Extract scores from the page
      let scores = await this.extractScores(page);
      
      if (scores.walk_score !== null || scores.transit_score !== null) {
        console.log(`[WalkScore] Extracted scores:`, scores);
        return {
          success: true,
          data: scores,
        };
      }
      
      // Try encoded URL format as fallback
      const fullAddress = zipCode 
        ? `${address}, ${city}, ${state} ${zipCode}`
        : `${address}, ${city}, ${state}`;
      
      const encodedUrl = `${this.baseUrl}/score/${encodeURIComponent(fullAddress)}`;
      console.log(`[WalkScore] Trying encoded URL: ${encodedUrl}`);
      
      await page.goto(encodedUrl, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      
      await this.dismissOverlays(page);
      await page.waitForTimeout(2000);
      
      scores = await this.extractScores(page);
      
      if (scores.walk_score !== null || scores.transit_score !== null) {
        console.log(`[WalkScore] Extracted scores:`, scores);
        return {
          success: true,
          data: scores,
        };
      }
      
      // Last resort: use search form
      console.log('[WalkScore] Direct URLs failed, trying search...');
      return await this.scrapeViaSearch(page, fullAddress);
      
    } catch (error) {
      console.error(`[WalkScore] Scraping failed:`, error.message);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }
  
  /**
   * Get state abbreviation from full name
   */
  getStateAbbr(stateName) {
    const stateToAbbr = Object.fromEntries(
      Object.entries(STATE_NAMES).map(([abbr, name]) => [name.replace(/_/g, ' '), abbr])
    );
    return stateToAbbr[stateName] || stateName;
  }
  
  /**
   * Dismiss cookie banners and overlays that might block interaction
   */
  async dismissOverlays(page) {
    try {
      // Common cookie consent button selectors
      const consentSelectors = [
        'button[id*="accept"]',
        'button[class*="accept"]',
        'button[class*="consent"]',
        'a[id*="accept"]',
        '.cookie-accept',
        '#onetrust-accept-btn-handler',
        '.cc-accept',
        '[data-testid="cookie-accept"]',
      ];
      
      for (const selector of consentSelectors) {
        const btn = await page.$(selector);
        if (btn) {
          await btn.click().catch(() => {});
          await page.waitForTimeout(500);
          break;
        }
      }
    } catch (e) {
      // Ignore overlay dismissal errors
    }
  }

  /**
   * Alternative scrape method using the search form.
   */
  async scrapeViaSearch(page, fullAddress) {
    try {
      // Go to the main page
      await page.goto(this.baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await this.dismissOverlays(page);
      await page.waitForTimeout(1000);
      
      // Multiple selectors for the search input (WalkScore changes their UI)
      const searchSelectors = [
        '#gs-search-box',
        'input[name="location"]',
        'input[placeholder*="address"]',
        'input[placeholder*="Address"]',
        '.search-input input',
        'input.search-box',
        'input[type="search"]',
        '#location-search',
      ];
      
      let searchInput = null;
      for (const selector of searchSelectors) {
        searchInput = await page.$(selector);
        if (searchInput) {
          // Check if it's visible
          const isVisible = await searchInput.isVisible().catch(() => false);
          if (isVisible) {
            console.log(`[WalkScore] Found visible search input: ${selector}`);
            break;
          }
          searchInput = null;
        }
      }
      
      if (searchInput) {
        await searchInput.click();
        await searchInput.fill(fullAddress);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
        
        const scores = await this.extractScores(page);
        
        if (scores.walk_score !== null) {
          return {
            success: true,
            data: scores,
          };
        }
      } else {
        console.log('[WalkScore] No visible search input found');
      }
      
      return {
        success: false,
        error: 'Could not find scores on page',
        data: { walk_score: null, transit_score: null, bike_score: null },
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  /**
   * Extract scores from the current page.
   * WalkScore displays scores in various elements with specific classes/attributes.
   */
  async extractScores(page) {
    const result = {
      walk_score: null,
      transit_score: null,
      bike_score: null,
      walk_description: null,
      transit_description: null,
      bike_description: null,
    };
    
    try {
      // Method 1: Look for score badges using data-eventsrc attributes and alt text
      const scoreData = await page.evaluate(() => {
        const scores = {
          walk_score: null,
          transit_score: null,
          bike_score: null,
        };
        
        // Primary method: Look for badge elements with data-eventsrc attribute
        // Walk Score badge
        const walkBadge = document.querySelector('[data-eventsrc="score page walk badge"]');
        if (walkBadge) {
          const img = walkBadge.querySelector('img') || walkBadge;
          const alt = img.getAttribute('alt') || '';
          // Parse: "43 Walk Score of 123 Main St..."
          const match = alt.match(/^(\d+)\s*Walk\s*Score/i);
          if (match) scores.walk_score = parseInt(match[1], 10);
        }
        
        // Transit Score badge
        const transitBadge = document.querySelector('[data-eventsrc="score page transit badge"]');
        if (transitBadge) {
          const img = transitBadge.querySelector('img') || transitBadge;
          const alt = img.getAttribute('alt') || '';
          // Parse: "37 Transit Score of 123 Main St..."
          const match = alt.match(/^(\d+)\s*Transit\s*Score/i);
          if (match) scores.transit_score = parseInt(match[1], 10);
        }
        
        // Bike Score badge
        const bikeBadge = document.querySelector('[data-eventsrc="score page bike badge"]');
        if (bikeBadge) {
          const img = bikeBadge.querySelector('img') || bikeBadge;
          const alt = img.getAttribute('alt') || '';
          // Parse: "50 Bike Score of 123 Main St..."
          const match = alt.match(/^(\d+)\s*Bike\s*Score/i);
          if (match) scores.bike_score = parseInt(match[1], 10);
        }
        
        // Fallback: Look for any img with alt containing score info
        if (scores.walk_score === null || scores.transit_score === null) {
          document.querySelectorAll('img[alt*="Score"]').forEach(img => {
            const alt = img.getAttribute('alt') || '';
            
            if (scores.walk_score === null) {
              const walkMatch = alt.match(/^(\d+)\s*Walk\s*Score/i);
              if (walkMatch) scores.walk_score = parseInt(walkMatch[1], 10);
            }
            
            if (scores.transit_score === null) {
              const transitMatch = alt.match(/^(\d+)\s*Transit\s*Score/i);
              if (transitMatch) scores.transit_score = parseInt(transitMatch[1], 10);
            }
            
            if (scores.bike_score === null) {
              const bikeMatch = alt.match(/^(\d+)\s*Bike\s*Score/i);
              if (bikeMatch) scores.bike_score = parseInt(bikeMatch[1], 10);
            }
          });
        }
        
        // Secondary fallback: Look in page text
        if (scores.walk_score === null) {
          const pageText = document.body.innerText;
          const walkMatch = pageText.match(/Walk\s*Score[®:\s]+(\d+)/i);
          if (walkMatch) scores.walk_score = parseInt(walkMatch[1], 10);
          
          const transitMatch = pageText.match(/Transit\s*Score[®:\s]+(\d+)/i);
          if (transitMatch) scores.transit_score = parseInt(transitMatch[1], 10);
          
          const bikeMatch = pageText.match(/Bike\s*Score[®:\s]+(\d+)/i);
          if (bikeMatch) scores.bike_score = parseInt(bikeMatch[1], 10);
        }
        
        return scores;
      });
      
      result.walk_score = scoreData.walk_score;
      result.transit_score = scoreData.transit_score;
      result.bike_score = scoreData.bike_score;
      
    } catch (error) {
      console.error('[WalkScore] Error extracting scores:', error.message);
    }
    
    return result;
  }
}

export { WalkScoreScraper, STATE_NAMES };

