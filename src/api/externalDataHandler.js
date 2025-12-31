/**
 * External Data API Handler
 * 
 * Provides REST API endpoints for scraping external data from:
 * - BestPlaces.net (crime statistics)
 * - GreatSchools.org (school ratings)
 * 
 * These endpoints use Playwright to perform headless web scraping
 * and return structured JSON data for property analysis.
 */

import express from 'express';
import { ScraperService } from '../services/scrapers/scraper_service.js';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

// Output directory for scraped data
const SCRAPED_DATA_DIR = path.join(process.cwd(), 'uploads', 'external');

// Ensure output directory exists
const ensureOutputDir = async () => {
  await fs.mkdir(SCRAPED_DATA_DIR, { recursive: true });
};

/**
 * POST /api/external/scrape
 * 
 * Fetch all external data (crime + schools) for a property address.
 * 
 * Request Body:
 * {
 *   "address": "123 Main St",
 *   "city": "Phoenix",
 *   "state": "AZ",
 *   "zipCode": "85001",
 *   "saveToFile": true  // Optional: save results to JSON file
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "crime": { ... },
 *     "schools": { ... }
 *   },
 *   "outputFile": "external_data_85001_2024-01-15.json" // if saveToFile=true
 * }
 */
router.post('/scrape', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { address, city, state, zipCode, saveToFile = false } = req.body;

    // Validate required fields
    if (!address || !city || !state || !zipCode) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields. Please provide: address, city, state, zipCode',
      });
    }

    // Validate state code format
    if (!/^[A-Z]{2}$/i.test(state)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid state code. Please use two-letter state abbreviation (e.g., AZ, CA)',
      });
    }

    // Validate zip code format
    if (!/^\d{5}(-\d{4})?$/.test(zipCode)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid zip code format. Please use 5-digit format (e.g., 85001)',
      });
    }

    console.log('[ExternalData] Starting full scrape for:', { address, city, state, zipCode });

    // Initialize scraper service and run
    const scraper = new ScraperService({
      headless: true,
      timeout: 45000,
      retryAttempts: 2,
    });

    const result = await scraper.scrapeAllData({
      address,
      city,
      state: state.toUpperCase(),
      zipCode,
    });

    const duration = Date.now() - startTime;
    console.log(`[ExternalData] Scraping completed in ${duration}ms`);

    // Save to file if requested
    let outputFile = null;
    if (saveToFile) {
      await ensureOutputDir();
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `external_data_${zipCode}_${timestamp}.json`;
      outputFile = path.join(SCRAPED_DATA_DIR, filename);
      
      await fs.writeFile(outputFile, JSON.stringify(result, null, 2));
      console.log(`[ExternalData] Saved to: ${outputFile}`);
    }

    res.json({
      success: result.success,
      data: result,
      duration: `${duration}ms`,
      outputFile: outputFile ? path.relative(process.cwd(), outputFile) : null,
    });

  } catch (error) {
    console.error('[ExternalData] Scrape error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/external/crime/:state/:zipCode
 * 
 * Fetch crime data only from BestPlaces.net.
 * 
 * URL Parameters:
 * - state: Two-letter state code (e.g., AZ)
 * - zipCode: 5-digit zip code (e.g., 85001)
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "violent_crime_index": 45.2,
 *     "property_crime_index": 52.1,
 *     "total_crime_index": 48.6,
 *     "source": "BestPlaces.net"
 *   }
 * }
 */
router.get('/crime/:state/:zipCode', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { state, zipCode } = req.params;

    // Validate state code format
    if (!/^[A-Z]{2}$/i.test(state)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid state code. Please use two-letter state abbreviation (e.g., AZ, CA)',
      });
    }

    // Validate zip code format
    if (!/^\d{5}$/.test(zipCode)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid zip code format. Please use 5-digit format (e.g., 85001)',
      });
    }

    console.log(`[ExternalData] Scraping crime data for: ${state} ${zipCode}`);

    const scraper = new ScraperService({
      headless: true,
      timeout: 45000,
      retryAttempts: 2,
    });

    // Initialize browser, scrape, then close
    await scraper.initBrowser();
    const result = await scraper.scrapeCrimeData(state.toUpperCase(), zipCode);
    await scraper.closeBrowser();

    const duration = Date.now() - startTime;

    res.json({
      success: result.success,
      data: result.data,
      error: result.success ? null : result.error,
      duration: `${duration}ms`,
    });

  } catch (error) {
    console.error('[ExternalData] Crime scrape error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/external/schools
 * 
 * Fetch school ratings from GreatSchools.org.
 * 
 * Query Parameters:
 * - address: Street address
 * - city: City name
 * - state: Two-letter state code
 * - zipCode: 5-digit zip code
 * 
 * Example: /api/external/schools?address=123+Main+St&city=Phoenix&state=AZ&zipCode=85001
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "elementary": { "name": "...", "rating": 7 },
 *     "high": { "name": "...", "rating": 8 },
 *     "source": "GreatSchools.org"
 *   }
 * }
 */
router.get('/schools', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { address, city, state, zipCode } = req.query;

    // Validate required fields
    if (!address || !city || !state || !zipCode) {
      return res.status(400).json({
        success: false,
        error: 'Missing required query parameters. Please provide: address, city, state, zipCode',
      });
    }

    // Validate state code format
    if (!/^[A-Z]{2}$/i.test(state)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid state code. Please use two-letter state abbreviation (e.g., AZ, CA)',
      });
    }

    console.log(`[ExternalData] Scraping school data for: ${address}, ${city}, ${state}`);

    const scraper = new ScraperService({
      headless: true,
      timeout: 45000,
      retryAttempts: 2,
    });

    // Initialize browser, scrape, then close
    await scraper.initBrowser();
    const result = await scraper.scrapeSchoolData(address, city, state.toUpperCase(), zipCode);
    await scraper.closeBrowser();

    const duration = Date.now() - startTime;

    res.json({
      success: result.success,
      data: result.data,
      error: result.success ? null : result.error,
      duration: `${duration}ms`,
    });

  } catch (error) {
    console.error('[ExternalData] Schools scrape error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/external/status
 * 
 * Check if the scraper service is available and working.
 * 
 * Response:
 * {
 *   "success": true,
 *   "status": "ready",
 *   "playwright": true
 * }
 */
router.get('/status', async (req, res) => {
  try {
    // Quick test to verify Playwright is working
    const scraper = new ScraperService({ headless: true });
    
    await scraper.initBrowser();
    const page = await scraper.createPage();
    await page.goto('about:blank');
    await page.close();
    await scraper.closeBrowser();

    res.json({
      success: true,
      status: 'ready',
      playwright: true,
      message: 'Scraper service is operational',
    });

  } catch (error) {
    console.error('[ExternalData] Status check failed:', error);
    res.json({
      success: false,
      status: 'error',
      playwright: false,
      error: error.message,
    });
  }
});

export default router;

