# CoStar Data Extraction Analysis Report

## Executive Summary

This document analyzes the data extraction capabilities of the full Docling processor and identifies gaps that require external data sources.

---

## Full Docling Run Results

**Test File:** Hawks Landing CoStar.pdf (127 pages)
**Processing Time:** ~154 seconds
**Section Files Generated:** 7

| Section | Pages | Tables | File |
|---------|-------|--------|------|
| Subject Property | 7 | 5 | `e_Hawks Landing CoStar_subject_property.json` |
| Rent Comps | 45 | 86 | `e_Hawks Landing CoStar_rent_comps.json` |
| Construction | 36 | 19 | `e_Hawks Landing CoStar_construction.json` |
| Sale Comps | 21 | 31 | `e_Hawks Landing CoStar_sale_comps.json` |
| Demographics | 13 | 15 | `e_Hawks Landing CoStar_demographics.json` |
| Submarket Report | 4 | 6 | `e_Hawks Landing CoStar_submarket_report.json` |
| Unknown | 1 | 8 | `e_Hawks Landing CoStar_unknown.json` |

---

## Data Coverage Analysis

### Data Successfully Extracted from CoStar PDF

| Data Point | Location | Status |
|------------|----------|--------|
| **Property Details** | | |
| No. of Units | Subject Property | ✅ Extracted (144) |
| Stories | Subject Property | ✅ Extracted (3) |
| Avg Unit Size | Subject Property | ✅ Extracted (969 SF) |
| Year Built | Subject Property | ✅ Extracted (Nov 2018) |
| Property Manager | Subject Property | ✅ Extracted |
| Owner | Subject Property | ✅ Extracted |
| Purchase Price | Subject Property | ✅ Extracted ($29.3M) |
| **Demographics (1/3/5 Mile)** | | |
| Population (2023) | Submarket Report | ✅ Extracted (6,349 / 41,435 / 71,231) |
| Population (2028 Forecast) | Submarket Report | ✅ Extracted |
| Population Growth % | Submarket Report | ✅ Extracted (3.8% / 2.4% / 1.8%) |
| Households | Submarket Report | ✅ Extracted |
| Median Household Income | Submarket Report | ✅ Extracted ($50,132 / $53,216 / $51,062) |
| Average Age | Submarket Report | ✅ Extracted (42 / 41 / 41) |
| **Market Analytics** | | |
| Metro Population | Demographics | ✅ Extracted (370,626) |
| Metro Households | Demographics | ✅ Extracted (152,847) |
| Metro Median HH Income | Demographics | ✅ Extracted ($62,592) |
| Labor Force | Demographics | ✅ Extracted (176,827) |
| Unemployment Rate | Demographics | ✅ Extracted (3.2%) |
| **Submarket Analytics** | | |
| Inventory (Units) | Demographics | ✅ Extracted (City Of Hickory: 5,001) |
| Vacancy Rate | Demographics | ✅ Extracted (7.9%) |
| 12 Month Absorption | Demographics | ✅ Extracted |
| Under Construction | Demographics | ✅ Extracted (153 units) |
| **Rent/Sale Data** | | |
| Asking Rents | Rent Comps | ✅ Extracted |
| Unit Mix Details | Subject Property | ✅ Extracted |
| Sale Comp Details | Sale Comps | ✅ Extracted |
| Top Buyers/Sellers | Submarket Report | ✅ Extracted |

### Data NOT in CoStar PDF (Requires External Sources)

| Data Point | Required Source | Status |
|------------|-----------------|--------|
| Walk Score | Walk Score API | ❌ Not in PDF |
| Transit Score | Walk Score API | ❌ Not in PDF |
| Bike Score | Walk Score API | ❌ Not in PDF |
| Violent Crime Rate | BestPlaces.net | ❌ Not in PDF |
| Property Crime Rate | BestPlaces.net | ❌ Not in PDF |
| School Ratings (Elementary) | GreatSchools.org | ❌ Not in PDF |
| School Ratings (High School) | GreatSchools.org | ❌ Not in PDF |
| Assigned School Names | GreatSchools.org | ❌ Not in PDF |

---

## External API Options

### 1. Walk Score API
**URL:** https://www.walkscore.com/professional/api.php

**Features:**
- Walk Score (0-100)
- Transit Score (0-100)
- Bike Score (0-100)

**Pricing:**
- Free trial available
- Request API key at walkscore.com
- Commercial pricing varies by usage

**API Endpoint:**
```
https://api.walkscore.com/score?format=json&address={address}&lat={lat}&lon={lon}&transit=1&bike=1&wsapikey={key}
```

**Response includes:**
- `walkscore`: 0-100
- `transit.score`: 0-100 (if available)
- `bike.score`: 0-100 (if available)

---

### 2. GreatSchools NearbySchools™ API
**URL:** https://solutions.greatschools.org/k12-data-solutions/nearbyschools-api

**Features:**
- School names, addresses, types
- School ratings (below average / average / above average)
- Assigned schools by address
- 150,000+ schools in database

**Pricing:**
| Plan | Price/Month | API Calls | Extra Calls |
|------|-------------|-----------|-------------|
| School Essentials | $52.50 | 15,000 | $0.003/call |
| School Quality | $97.50 | 15,000 | $0.006/call |

- 14-day free trial available
- Requires attribution and backlinks to GreatSchools.org

---

### 3. FBI Crime Data Explorer API
**URL:** https://cde.ucr.cjis.gov/

**Features:**
- National crime statistics
- Agency/county/state level data
- Free access

**Limitations:**
- Data is at agency/county level, NOT zip code level
- Cannot replicate BestPlaces.net zip code comparison
- Best for metro/county level crime trends

---

### 4. BestPlaces.net
**URL:** https://www.bestplaces.net/

**Features:**
- Zip code level crime rates
- Violent crime index vs national average
- Property crime index vs national average

**API Status:** No public API available

**Options:**
1. Manual lookup via website
2. Web scraping (compliance review required)
3. Data licensing (contact for enterprise agreement)

---

## Recommended Implementation

### Phase 1: Immediate (Free/Low-Cost)

1. **Walk Score API** - Request free API key, implement scoring lookup
2. **Census Bureau API** - Free access to demographic data backup

### Phase 2: Paid Services

1. **GreatSchools API** - Start with School Quality plan ($97.50/mo) for school ratings
2. Consider 14-day free trial first

### Phase 3: Data Licensing

1. **BestPlaces.net** - Contact for data licensing if crime data is critical
2. Alternative: Use FBI Crime Data + local police data sources

---

## Data Flow Architecture

```
CoStar PDF Upload
       |
       v
+------------------+
| Full Docling Run |
+------------------+
       |
       v
+------------------------+
| Section JSON Files     |
| - Subject Property     |
| - Demographics (1/3/5) |
| - Submarket Report     |
| - Market Report        |
+------------------------+
       |
       v
+------------------------+
| External API Enrichment|
| - Walk Score API       |
| - GreatSchools API     |
| - BestPlaces (manual)  |
+------------------------+
       |
       v
+------------------------+
| Combined Dataset       |
| Ready for Excel Fill   |
+------------------------+
```

---

## Conclusion

The full Docling processor successfully extracts **most** of the required data directly from CoStar PDFs:

- ✅ **Property details** - Complete
- ✅ **Demographics (1/3/5 mile)** - Complete
- ✅ **Market/Submarket analytics** - Complete
- ❌ **Walk/Transit Score** - Requires Walk Score API
- ❌ **Crime Data** - Requires BestPlaces or manual lookup
- ❌ **School Ratings** - Requires GreatSchools API

**Estimated Data Coverage:** 80-85% from CoStar PDF alone

