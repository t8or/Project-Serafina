/**
 * Scraper Service - Main orchestrator for web scraping operations.
 * 
 * This service manages Playwright browser instances and coordinates
 * the BestPlaces and GreatSchools scrapers to gather external data
 * for property analysis.
 */

import { chromium } from 'playwright';
import { BestPlacesScraper } from './bestplaces_scraper.js';
import { GreatSchoolsScraper } from './greatschools_scraper.js';
import { WalkScoreScraper } from './walkscore_scraper.js';

// Browser configuration defaults
const DEFAULT_CONFIG = {
  headless: true,
  timeout: 30000,           // 30 second timeout per operation
  navigationTimeout: 60000, // 60 second timeout for page loads
  retryAttempts: 2,
  retryDelay: 2000,         // 2 seconds between retries
  requestDelay: 1500,       // 1.5 seconds between requests (rate limiting)
};

// Realistic user agent to avoid detection
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * ScraperService - Main class for coordinating web scraping operations.
 * 
 * Features:
 * - Manages single browser instance for efficiency
 * - Coordinates multiple scrapers (BestPlaces, GreatSchools)
 * - Implements retry logic with headless fallback
 * - Rate limiting to avoid detection
 * - Structured JSON output
 */
class ScraperService {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.browser = null;
    this.context = null;
    
    // Initialize individual scrapers
    this.bestPlacesScraper = new BestPlacesScraper(this.config);
    this.greatSchoolsScraper = new GreatSchoolsScraper(this.config);
    this.walkScoreScraper = new WalkScoreScraper(this.config);
  }

  /**
   * Initialize the browser instance.
   * 
   * @param {boolean} headless - Whether to run in headless mode
   * @returns {Promise<void>}
   */
  async initBrowser(headless = this.config.headless) {
    if (this.browser) {
      await this.closeBrowser();
    }

    console.log(`[ScraperService] Launching browser (headless: ${headless})`);
    
    this.browser = await chromium.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    });

    // Create browser context with realistic settings
    this.context = await this.browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      geolocation: { latitude: 40.7128, longitude: -74.0060 }, // NYC default
      permissions: ['geolocation'],
    });

    // Set default timeout
    this.context.setDefaultTimeout(this.config.timeout);
    this.context.setDefaultNavigationTimeout(this.config.navigationTimeout);

    console.log('[ScraperService] Browser initialized successfully');
  }

  /**
   * Close the browser instance.
   * 
   * @returns {Promise<void>}
   */
  async closeBrowser() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    console.log('[ScraperService] Browser closed');
  }

  /**
   * Create a new page with anti-detection measures.
   * 
   * @returns {Promise<Page>} Playwright page instance
   */
  async createPage() {
    if (!this.context) {
      await this.initBrowser();
    }

    const page = await this.context.newPage();

    // Add anti-detection scripts
    await page.addInitScript(() => {
      // Override webdriver detection
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Override plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    });

    return page;
  }

  /**
   * Add a random delay to simulate human behavior.
   * 
   * @param {number} baseDelay - Base delay in milliseconds
   * @returns {Promise<void>}
   */
  async randomDelay(baseDelay = this.config.requestDelay) {
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
    await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
  }

  /**
   * Scrape crime data from BestPlaces.net.
   * Supports both zip code and city-based lookups.
   * 
   * @param {string} state - Two-letter state code (e.g., 'AZ')
   * @param {string} zipCodeOrCity - 5-digit zip code or city name
   * @param {boolean} useCity - If true, use city-based URL
   * @returns {Promise<Object>} Crime data with indices
   */
  async scrapeCrimeData(state, zipCodeOrCity, useCity = false) {
    console.log(`[ScraperService] Scraping crime data for ${zipCodeOrCity}, ${state} (useCity: ${useCity})`);
    
    let lastError = null;
    let headless = this.config.headless;

    // Retry loop with headless fallback
    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        // On last retry, try with visible browser
        if (attempt === this.config.retryAttempts && headless) {
          console.log('[ScraperService] Retrying with visible browser...');
          headless = false;
          await this.initBrowser(false);
        } else if (!this.browser) {
          await this.initBrowser(headless);
        }

        const page = await this.createPage();
        
        try {
          const result = await this.bestPlacesScraper.scrape(page, state, zipCodeOrCity, useCity);
          await page.close();
          return result;
        } finally {
          if (!page.isClosed()) {
            await page.close();
          }
        }

      } catch (error) {
        lastError = error;
        console.error(`[ScraperService] Crime scrape attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < this.config.retryAttempts) {
          await this.randomDelay(this.config.retryDelay);
        }
      }
    }

    // All attempts failed - return error result
    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      data: null,
    };
  }

  /**
   * Scrape Walk Score, Transit Score, Bike Score from WalkScore.com.
   * 
   * @param {string} address - Street address
   * @param {string} city - City name
   * @param {string} state - Two-letter state code
   * @param {string} zipCode - 5-digit zip code (optional)
   * @returns {Promise<Object>} WalkScore data with scores
   */
  async scrapeWalkScore(address, city, state, zipCode) {
    console.log(`[ScraperService] Scraping WalkScore for ${address}, ${city}, ${state}`);
    
    let lastError = null;
    let headless = this.config.headless;

    // Retry loop with headless fallback
    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        // On last retry, try with visible browser
        if (attempt === this.config.retryAttempts && headless) {
          console.log('[ScraperService] Retrying with visible browser...');
          headless = false;
          await this.initBrowser(false);
        } else if (!this.browser) {
          await this.initBrowser(headless);
        }

        const page = await this.createPage();
        
        try {
          const result = await this.walkScoreScraper.scrape(page, address, city, state, zipCode);
          await page.close();
          return result;
        } finally {
          if (!page.isClosed()) {
            await page.close();
          }
        }

      } catch (error) {
        lastError = error;
        console.error(`[ScraperService] WalkScore scrape attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < this.config.retryAttempts) {
          await this.randomDelay(this.config.retryDelay);
        }
      }
    }

    // All attempts failed - return error result
    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      data: null,
    };
  }

  /**
   * Scrape school data from GreatSchools.org for a given address.
   * 
   * @param {string} address - Street address
   * @param {string} city - City name
   * @param {string} state - Two-letter state code
   * @param {string} zipCode - 5-digit zip code
   * @returns {Promise<Object>} School data with ratings
   */
  async scrapeSchoolData(address, city, state, zipCode) {
    console.log(`[ScraperService] Scraping school data for ${address}, ${city}, ${state}`);
    
    let lastError = null;
    let headless = this.config.headless;

    // Retry loop with headless fallback
    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        // On last retry, try with visible browser
        if (attempt === this.config.retryAttempts && headless) {
          console.log('[ScraperService] Retrying with visible browser...');
          headless = false;
          await this.initBrowser(false);
        } else if (!this.browser) {
          await this.initBrowser(headless);
        }

        const page = await this.createPage();
        
        try {
          const result = await this.greatSchoolsScraper.scrape(page, address, city, state, zipCode);
          await page.close();
          return result;
        } finally {
          if (!page.isClosed()) {
            await page.close();
          }
        }

      } catch (error) {
        lastError = error;
        console.error(`[ScraperService] School scrape attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < this.config.retryAttempts) {
          await this.randomDelay(this.config.retryDelay);
        }
      }
    }

    // All attempts failed - return error result
    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      data: null,
    };
  }

  /**
   * Scrape all external data for a property address.
   * 
   * This method coordinates both BestPlaces and GreatSchools scrapers
   * to gather complete external data for property analysis.
   * Supports city-based lookups when zip code is not available.
   * 
   * @param {Object} propertyInfo - Property information
   * @param {string} propertyInfo.address - Street address
   * @param {string} propertyInfo.city - City name
   * @param {string} propertyInfo.state - Two-letter state code (e.g., 'AZ')
   * @param {string} propertyInfo.zipCode - 5-digit zip code (optional)
   * @returns {Promise<Object>} Combined external data
   */
  async scrapeAllData(propertyInfo) {
    const { address, city, state, zipCode } = propertyInfo;
    
    // Determine if we should use city-based lookup
    const useCity = !zipCode && city;
    const locationKey = useCity ? city : zipCode;
    
    console.log('[ScraperService] Starting full external data scrape');
    console.log(`[ScraperService] Property: ${address}, ${city}, ${state} ${zipCode || '(no zip)'}`);
    console.log(`[ScraperService] Using ${useCity ? 'city' : 'zip'}-based lookup: ${locationKey}`);

    // Validate we have enough location data
    if (!state || (!zipCode && !city)) {
      return {
        success: false,
        error: 'Insufficient location data - need state and either city or zip code',
        timestamp: new Date().toISOString(),
        property: { address, city, state, zipCode },
        crime: null,
        schools: null,
        errors: [{ source: 'validation', error: 'Missing state or location identifier' }],
      };
    }

    try {
      // Initialize browser once for all scraping
      await this.initBrowser();

      // Scrape crime data (use city if no zip)
      const crimeResult = await this.scrapeCrimeData(state, locationKey, useCity);
      
      // Add delay between scraping different sites
      await this.randomDelay();

      // Scrape school data
      const schoolResult = await this.scrapeSchoolData(address, city, state, zipCode);
      
      // Add delay between scraping different sites
      await this.randomDelay();
      
      // Scrape WalkScore data
      const walkScoreResult = await this.scrapeWalkScore(address, city, state, zipCode);

      // Combine results
      const result = {
        success: true,
        timestamp: new Date().toISOString(),
        property: {
          address,
          city,
          state,
          zipCode,
        },
        lookupMethod: useCity ? 'city' : 'zipCode',
        crime: crimeResult.success ? crimeResult.data : {
          error: crimeResult.error,
          violent_crime_index: null,
          property_crime_index: null,
          total_crime_index: null,
        },
        schools: schoolResult.success ? schoolResult.data : {
          error: schoolResult.error,
          elementary: null,
          high: null,
        },
        walkScore: walkScoreResult.success ? walkScoreResult.data : {
          error: walkScoreResult.error,
          walk_score: null,
          transit_score: null,
          bike_score: null,
        },
        errors: [],
      };

      // Track any errors
      if (!crimeResult.success) {
        result.errors.push({ source: 'BestPlaces', error: crimeResult.error });
      }
      if (!schoolResult.success) {
        result.errors.push({ source: 'GreatSchools', error: schoolResult.error });
      }
      if (!walkScoreResult.success) {
        result.errors.push({ source: 'WalkScore', error: walkScoreResult.error });
      }

      // Set overall success based on partial success
      result.success = crimeResult.success || schoolResult.success || walkScoreResult.success;

      return result;

    } finally {
      await this.closeBrowser();
    }
  }
}

export { ScraperService };

