/**
 * Scraper Test Script
 * 
 * Tests the BestPlaces and GreatSchools scrapers with a real address.
 * Run with: node src/services/scrapers/test_scrapers.js
 */

import { ScraperService } from './scraper_service.js';

// Test data - Hawks Landing property from extracted CoStar report
const TEST_PROPERTY = {
  address: '2250 21st Ave Dr SE',
  city: 'Hickory',
  state: 'NC',
  zipCode: '28602',
};

async function runTests() {
  console.log('='.repeat(60));
  console.log('SCRAPER SERVICE TEST');
  console.log('='.repeat(60));
  console.log('\nTest Property:');
  console.log(`  Address: ${TEST_PROPERTY.address}`);
  console.log(`  City: ${TEST_PROPERTY.city}`);
  console.log(`  State: ${TEST_PROPERTY.state}`);
  console.log(`  Zip: ${TEST_PROPERTY.zipCode}`);
  console.log('\n');

  const scraper = new ScraperService({
    headless: true,
    timeout: 45000,
    retryAttempts: 2,
  });

  try {
    // Test 1: Crime Data from BestPlaces
    console.log('='.repeat(60));
    console.log('TEST 1: BestPlaces Crime Data');
    console.log('='.repeat(60));
    
    const startCrime = Date.now();
    await scraper.initBrowser();
    const crimeResult = await scraper.scrapeCrimeData(TEST_PROPERTY.state, TEST_PROPERTY.zipCode);
    const crimeDuration = Date.now() - startCrime;
    
    console.log('\nResult:');
    console.log(JSON.stringify(crimeResult, null, 2));
    console.log(`\nDuration: ${crimeDuration}ms`);

    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 2: School Data from GreatSchools
    console.log('\n' + '='.repeat(60));
    console.log('TEST 2: GreatSchools School Data');
    console.log('='.repeat(60));
    
    const startSchool = Date.now();
    const schoolResult = await scraper.scrapeSchoolData(
      TEST_PROPERTY.address,
      TEST_PROPERTY.city,
      TEST_PROPERTY.state,
      TEST_PROPERTY.zipCode
    );
    const schoolDuration = Date.now() - startSchool;
    
    console.log('\nResult:');
    console.log(JSON.stringify(schoolResult, null, 2));
    console.log(`\nDuration: ${schoolDuration}ms`);

    await scraper.closeBrowser();

    // Small delay before full test
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 3: Full Scrape
    console.log('\n' + '='.repeat(60));
    console.log('TEST 3: Full External Data Scrape');
    console.log('='.repeat(60));
    
    const startFull = Date.now();
    const fullResult = await scraper.scrapeAllData(TEST_PROPERTY);
    const fullDuration = Date.now() - startFull;
    
    console.log('\nResult:');
    console.log(JSON.stringify(fullResult, null, 2));
    console.log(`\nDuration: ${fullDuration}ms`);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Crime Data: ${crimeResult.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`School Data: ${schoolResult.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`Full Scrape: ${fullResult.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`\nTotal test time: ${crimeDuration + schoolDuration + fullDuration}ms`);

  } catch (error) {
    console.error('\nTest failed with error:', error);
    await scraper.closeBrowser();
    process.exit(1);
  }
}

runTests().then(() => {
  console.log('\nTests completed!');
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

