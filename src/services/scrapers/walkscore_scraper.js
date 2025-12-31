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
      // Navigate to WalkScore with the address
      const fullAddress = zipCode 
        ? `${address}, ${city}, ${state} ${zipCode}`
        : `${address}, ${city}, ${state}`;
      
      const searchUrl = `${this.baseUrl}/score/${encodeURIComponent(fullAddress)}`;
      console.log(`[WalkScore] Navigating to: ${searchUrl}`);
      
      await page.goto(searchUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      
      // Wait for the page to load scores
      await page.waitForTimeout(2000);
      
      // Extract scores from the page
      const scores = await this.extractScores(page);
      
      if (scores.walk_score !== null || scores.transit_score !== null) {
        console.log(`[WalkScore] Extracted scores:`, scores);
        return {
          success: true,
          data: scores,
        };
      }
      
      // Try alternative method - search form
      console.log('[WalkScore] Direct URL failed, trying search...');
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
   * Alternative scrape method using the search form.
   */
  async scrapeViaSearch(page, fullAddress) {
    try {
      // Go to the main page
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      
      // Look for search input
      const searchInput = await page.$('input[type="text"], input[name="location"], #gs-search-box, .search-input');
      
      if (searchInput) {
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
      // Method 1: Look for score badges/circles (common WalkScore UI pattern)
      const scoreData = await page.evaluate(() => {
        const scores = {
          walk_score: null,
          transit_score: null,
          bike_score: null,
        };
        
        // Look for score elements with aria-label or specific classes
        const walkScoreEl = document.querySelector('[data-score-type="walk"]') ||
                           document.querySelector('.walkscore-badge .score') ||
                           document.querySelector('.ws-score') ||
                           document.querySelector('#walk-score');
        
        const transitScoreEl = document.querySelector('[data-score-type="transit"]') ||
                               document.querySelector('.transit-score .score') ||
                               document.querySelector('.ts-score') ||
                               document.querySelector('#transit-score');
        
        const bikeScoreEl = document.querySelector('[data-score-type="bike"]') ||
                            document.querySelector('.bike-score .score') ||
                            document.querySelector('.bs-score') ||
                            document.querySelector('#bike-score');
        
        // Extract numeric values
        if (walkScoreEl) {
          const text = walkScoreEl.textContent.trim();
          const match = text.match(/\d+/);
          if (match) scores.walk_score = parseInt(match[0], 10);
        }
        
        if (transitScoreEl) {
          const text = transitScoreEl.textContent.trim();
          const match = text.match(/\d+/);
          if (match) scores.transit_score = parseInt(match[0], 10);
        }
        
        if (bikeScoreEl) {
          const text = bikeScoreEl.textContent.trim();
          const match = text.match(/\d+/);
          if (match) scores.bike_score = parseInt(match[0], 10);
        }
        
        // Alternative: Look for score numbers in the page
        if (scores.walk_score === null) {
          const pageText = document.body.innerText;
          
          // Pattern: "Walk Score: 43" or "Walk Score® 43"
          const walkMatch = pageText.match(/Walk\s*Score[®:\s]+(\d+)/i);
          if (walkMatch) scores.walk_score = parseInt(walkMatch[1], 10);
          
          const transitMatch = pageText.match(/Transit\s*Score[®:\s]+(\d+)/i);
          if (transitMatch) scores.transit_score = parseInt(transitMatch[1], 10);
          
          const bikeMatch = pageText.match(/Bike\s*Score[®:\s]+(\d+)/i);
          if (bikeMatch) scores.bike_score = parseInt(bikeMatch[1], 10);
        }
        
        // Try JSON-LD data
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        scripts.forEach(script => {
          try {
            const data = JSON.parse(script.textContent);
            if (data.walkScore) scores.walk_score = parseInt(data.walkScore, 10);
            if (data.transitScore) scores.transit_score = parseInt(data.transitScore, 10);
            if (data.bikeScore) scores.bike_score = parseInt(data.bikeScore, 10);
          } catch (e) {}
        });
        
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

