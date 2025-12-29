# XLSX Template Field Mapping Reference

**Template:** Serafina UW Phoenix AZ Feb 14 2025.xlsx  
**Version:** 1.0.0  
**Last Updated:** December 29, 2025

---

## Overview

This document provides a comprehensive mapping of every input field in the underwriting model template. Each sheet is documented with:
- **Input Fields**: Cells that require data entry (manual or automated)
- **Formula Fields**: Calculated cells that should NOT be overwritten
- **Data Sources**: Whether data comes from CoStar PDF extraction or requires external input
- **CoStar JSON Paths**: Exact paths for automated data filling

---

## Data Source Legend

| Source | Symbol | Description |
|--------|--------|-------------|
| CoStar PDF | ✅ | Available from Docling extraction of CoStar report |
| External | 🔶 | Requires manual input or separate data source |
| Formula | 📊 | Calculated from other cells - DO NOT OVERWRITE |
| Cross-Sheet | 🔗 | References data from another sheet |

---

## Quick Reference: CoStar Coverage by Sheet

| Sheet | Total Inputs | CoStar Available | External Needed | Coverage |
|-------|--------------|------------------|-----------------|----------|
| Property Summary | 22 | 11 | 11 | ~50% |
| Demos | 40+ | 0 | 40+ | 0% |
| Historical Financials | 50+ | 0 | 50+ | 0% |
| Unit Mix & Comps | 15 cols | 7 cols | 8 cols | ~47% |
| Revenue | 100+ | 2 | 100+ | ~2% |
| Expenses | 80+ | 0 | 80+ | 0% |
| CapEx | 60+ | 0 | 60+ | 0% |
| Project Budget | 50+ | 0 | 50+ | 0% |
| Capital Stack | 30+ | 0 | 30+ | 0% |
| Cash Flows | 200+ | 0 | 0 | Formula-based |
| Waterfall | 150+ | 0 | 0 | Formula-based |
| Investment Summary | 100+ | 5 | 95+ | ~5% |

---

## Sheet 1: Property Summary

### Purpose
Contains the core property information displayed on the summary page. This is the primary "at a glance" view for decision makers.

### Tables in This Sheet

#### Table 1.1: Property Description (Cells B6:C16)

| Cell | Label | Data Type | Source | CoStar JSON Path | Notes |
|------|-------|-----------|--------|------------------|-------|
| C6 | Property Name | text | ✅ | `property.name` | Extract from first section content |
| C7 | Street Address | text | ✅ | `property.address` | From `sections_raw[0].header` |
| C8 | City | text | ✅ | `property.city` | Extract from location string |
| C9 | State | text | ✅ | `property.state` | Convert full name to abbreviation |
| C10 | County | text | 🔶 | - | Not in CoStar PDF |
| C11 | Zip Code | number | 🔶 | - | Not in CoStar PDF |
| C12 | Land Area | number | 🔶 | - | Not in CoStar PDF (acres) |
| C13 | Year Built | number | ✅ | `property.year_built` | Direct mapping |
| C14 | Year Renovated | text | 🔶 | - | Not in CoStar PDF |
| C15 | Management Type | text | 🔶 | - | Dropdown: "3rd Party Management" or "Self Managed" |
| C16 | Management Company | text | ✅ | `property_manager.name` | Direct mapping |

#### Table 1.2: Property Size (Cells E6:F10)

| Cell | Label | Data Type | Source | CoStar JSON Path | Transform |
|------|-------|-----------|--------|------------------|-----------|
| F6 | Total Units | number | ✅ | `property.no_of_units` | Direct |
| F7 | Avg Unit Size | number | ✅ | `property.avg_unit_size` | Direct (SF) |
| F8 | Current Vacancy | percentage | ✅ | `vacancy.current.rate` | Divide by 100 |
| F9 | Building(s) | number | 🔶 | - | Not in CoStar PDF |
| F10 | Floors | number | ✅ | `property.stories` | Direct |

#### Table 1.3: Purchase Metrics (Cells H6:I13)

| Cell | Label | Data Type | Source | CoStar JSON Path | Formula/Notes |
|------|-------|-----------|--------|------------------|---------------|
| I6 | Trailing 12 Revenue | currency | 🔶 | - | From property financials (OM) |
| I7 | Trailing 12 Expenses | currency | 🔶 | - | From property financials (OM) |
| I8 | Trailing 12 NOI | currency | 📊 | - | `=I6-I7` |
| I10 | Guidance Price | currency | 🔶 | - | Deal-specific asking price |
| I11 | Implied Cap Rate | percentage | 📊 | - | `=IFERROR(I8/I10,"")` |
| I12 | Price per Unit | currency | 📊 | - | `=IFERROR(I10/F6,"")` |
| I13 | Call for Offers Date | date | 🔶 | - | Deal-specific |

#### Table 1.4: Seller Information (Cells B19:C28)

| Cell | Label | Data Type | Source | CoStar JSON Path | Notes |
|------|-------|-----------|--------|------------------|-------|
| C19 | Seller Name | text | ✅ | `owner.name` | Direct mapping |
| C20 | How Long Have They Owned? | number | ✅ | `owner.purchase_date` | Transform: years_since_purchase |
| C21 | Last Sold Price | currency | ✅ | `owner.purchase_price_raw` | Convert to number |
| C22 | Why Are They Selling? | text | 🔶 | - | From broker conversations |
| C23 | What Improvements Have They Made? | text | 🔶 | - | From broker/OM |
| C24 | What Matters Most to Them? | text | 🔶 | - | From broker conversations |
| C25 | Broker's Name | text | 🔶 | - | Deal-specific |
| C26 | Brokerage | text | 🔶 | - | Deal-specific |
| C27 | Broker's Email | text | 🔶 | - | Deal-specific |
| C28 | Broker's Phone Number | text | 🔶 | - | Deal-specific |

### Formula Dependencies
```
I8 (NOI) = I6 (Revenue) - I7 (Expenses)
I11 (Cap Rate) = I8 (NOI) / I10 (Guidance Price)
I12 (Price/Unit) = I10 (Guidance Price) / F6 (Total Units)
B3 (City, State) = C8 & ", " & C9
```

---

## Sheet 2: Demos

### Purpose
Demographics analysis with weighted scoring system. Used to evaluate the property's location based on population, income, crime, schools, and transit metrics.

### Tables in This Sheet

#### Table 2.1: CoStar Demographics (Cells B6:E10)

| Cell | Label | Radius | Data Type | Source | Notes |
|------|-------|--------|-----------|--------|-------|
| C6 | Population | 1 Mile | number | 🔶 | From CoStar Demographics section (not in property PDF) |
| D6 | Population | 3 Mile | number | 🔶 | External data source |
| E6 | Population | 5 Mile | number | 🔶 | External data source |
| C7 | Population Growth | 1 Mile | percentage | 🔶 | Year-over-year growth |
| D7 | Population Growth | 3 Mile | percentage | 🔶 | |
| E7 | Population Growth | 5 Mile | percentage | 🔶 | |
| C8 | Median HH Income | 1 Mile | currency | 🔶 | |
| D8 | Median HH Income | 3 Mile | currency | 🔶 | |
| E8 | Median HH Income | 5 Mile | currency | 🔶 | |
| C9 | Median Home Value | 1 Mile | currency | 🔶 | |
| D9 | Median Home Value | 3 Mile | currency | 🔶 | |
| E9 | Median Home Value | 5 Mile | currency | 🔶 | |
| C10 | Renter Households % | 1 Mile | percentage | 🔶 | |
| D10 | Renter Households % | 3 Mile | percentage | 🔶 | |
| E10 | Renter Households % | 5 Mile | percentage | 🔶 | |

#### Table 2.2: Crime Rates - Best Places (Cells B12:E13)

| Cell | Label | Data Type | Source | Notes |
|------|-------|-----------|--------|-------|
| C12 | Violent Crime (Zip) | number | 🔶 | From bestplaces.net |
| D12 | Violent Crime (National Avg) | number | 🔶 | Reference: typically 22.7 |
| C13 | Property Crime (Zip) | number | 🔶 | From bestplaces.net |
| D13 | Property Crime (National Avg) | number | 🔶 | Reference: typically 35.4 |

#### Table 2.3: School Ratings - Great Schools (Cells B15:C16)

| Cell | Label | Data Type | Source | Notes |
|------|-------|-----------|--------|-------|
| C15 | Elementary School Rating | number | 🔶 | From greatschools.org (1-10) |
| C16 | High School Rating | number | 🔶 | From greatschools.org (1-10) |

#### Table 2.4: Walk/Transit Scores (Cells B18:C19)

| Cell | Label | Data Type | Source | Notes |
|------|-------|-----------|--------|-------|
| C18 | Walk Score | number | 🔶 | From walkscore.com (0-100) |
| C19 | Transit Score | number | 🔶 | From walkscore.com (0-100) |

#### Table 2.5: Submarket Analytics (Cells B21:C25)

| Cell | Label | Data Type | Source | Notes |
|------|-------|-----------|--------|-------|
| C21 | Submarket Vacancy | percentage | 🔶 | CoStar Analytics section |
| C22 | Inventory Units | number | 🔶 | |
| C23 | Delivered Units (12mo) | number | 🔶 | |
| C24 | Under Construction % | percentage | 🔶 | |
| C25 | Submarket Cap Rate | percentage | 🔶 | |

#### Table 2.6: Scoring Matrix (Cells I6:R19)

This is a **weighted scoring system** with configurable thresholds.

| Column | Purpose |
|--------|---------|
| I | Metric Name |
| J | Weighting (%) |
| K | Increment Value |
| L-R | Score thresholds (10 down to 4) |
| S | Figure (actual value) |
| T | Score (calculated) |

**Key Formula Pattern:**
```
Score = MATCH(Figure, Threshold_Range, 1)
Weighted Score = Score × Weighting
Total Score = SUM(Weighted Scores)
```

---

## Sheet 3: Historical Financials

### Purpose
Captures trailing 12-month (T12), 6-month (T6), and 3-month (T3) actual financial performance.

### Tables in This Sheet

#### Table 3.1: Property Units (Cells C6:E8)

| Cell | Label | Data Type | Source | Notes |
|------|-------|-----------|--------|-------|
| C6 | Total Units | number | 🔗 | Links to Property Summary!F6 |
| C7 | Occupied Units | number | 🔶 | From rent roll |
| C8 | Occupancy % | percentage | 📊 | `=C7/C6` |

#### Table 3.2: Revenue (Cells B10:G18)

| Row | Line Item | T12 | Per Unit | T6 | T3 |
|-----|-----------|-----|----------|----|----|
| 10 | Potential Rental Income | 🔶 | 📊 | 🔶 | 🔶 |
| 11 | Loss to Lease | 🔶 | 📊 | 🔶 | 🔶 |
| 12 | Vacancy Loss | 🔶 | 📊 | 🔶 | 🔶 |
| 13 | Bad Debt | 🔶 | 📊 | 🔶 | 🔶 |
| 14 | Concessions | 🔶 | 📊 | 🔶 | 🔶 |
| 15 | Total Rental Income | 📊 | 📊 | 📊 | 📊 |
| 16 | RUBS Income | 🔶 | 📊 | 🔶 | 🔶 |
| 17 | Other Income | 🔶 | 📊 | 🔶 | 🔶 |
| 18 | Total Revenue | 📊 | 📊 | 📊 | 📊 |

#### Table 3.3: Operating Expenses (Cells B20:G32)

| Row | Line Item | T12 | Per Unit | T6 | T3 |
|-----|-----------|-----|----------|----|----|
| 20 | G&A | 🔶 | 📊 | 🔶 | 🔶 |
| 21 | Payroll | 🔶 | 📊 | 🔶 | 🔶 |
| 22 | Leasing & Marketing | 🔶 | 📊 | 🔶 | 🔶 |
| 23 | Utilities | 🔶 | 📊 | 🔶 | 🔶 |
| 24 | Repairs & Maintenance | 🔶 | 📊 | 🔶 | 🔶 |
| 25 | HOA | 🔶 | 📊 | 🔶 | 🔶 |
| 26 | Turnover | 🔶 | 📊 | 🔶 | 🔶 |
| 27 | Contract Services | 🔶 | 📊 | 🔶 | 🔶 |
| 28 | Insurance | 🔶 | 📊 | 🔶 | 🔶 |
| 29 | Property Taxes | 🔶 | 📊 | 🔶 | 🔶 |
| 30 | Management Fees | 🔶 | 📊 | 🔶 | 🔶 |
| 31 | Total OpEx | 📊 | 📊 | 📊 | 📊 |
| 32 | Expense Ratio | 📊 | - | 📊 | 📊 |

#### Table 3.4: Net Operating Income (Cells B34:G35)

| Cell | Label | Formula |
|------|-------|---------|
| C34 | NOI (T12) | `=C18-C31` (Total Revenue - Total OpEx) |
| D34 | NOI per Unit | `=C34/$C$6` |
| E34 | NOI (T6) | `=E18-E31` |
| F34 | NOI (T3) | `=F18-F31` |

---

## Sheet 4: Unit Mix & Comps

### Purpose
Detailed breakdown of unit types with current rents, market comparisons, and renovation status tracking.

### Tables in This Sheet

#### Table 4.1: Property Unit Mix (Rows 7-27, Columns B-L)

This is an **array-based table** populated from CoStar's unit breakdown.

| Column | Label | Data Type | Source | CoStar JSON Path |
|--------|-------|-----------|--------|------------------|
| B | Unit Type | text | ✅ | Transform from `bed` + `bath` → "2B/1Ba" |
| C | Avg SF | number | ✅ | `avgSf` |
| D | Units | number | ✅ | `unitMix.units` |
| E | Occupied Units | number | ✅ | Calculate: `unitMix.units - availability.units` |
| F | Renovation Units | number | 🔶 | From property inspection |
| G | Unit Mix % | percentage | ✅ | `unitMix.mix%` (divide by 100) |
| H | Current Advertised Rent | currency | ✅ | `avgAskingRent.perUnit` |
| I | Gap to Achieved | currency | 📊 | `=H-J` |
| J | Average Effective Rent | currency | ✅ | `avgEffectiveRent.perUnit` |
| K | Price per SF | currency | ✅ | `avgAskingRent.perSf` |
| L | Rent per SF | currency | 📊 | `=J/C` |

**Array Source:** `structured_data[0].unitBreakdown[1].rows`

**Row Filtering:** Skip rows where `bed` contains "Totals" or "All X Beds"

#### Table 4.2: Market Rent Comparison (Cells N7:O10)

| Cell | Label | Data Type | Source | Notes |
|------|-------|-----------|--------|-------|
| O7 | Market Avg Asking Rent | currency | 🔶 | From comp analysis |
| O8 | Market Price per SF | currency | 🔶 | |
| O9 | Current vs Market (Rent) | currency | 📊 | `=AVERAGE(H:H)-O7` |
| O10 | Current vs Market (PSF) | currency | 📊 | `=AVERAGE(K:K)-O8` |

#### Table 4.3: Renovated Rent Premiums (Cells N12:O15)

| Cell | Label | Data Type | Source | Notes |
|------|-------|-----------|--------|-------|
| O12 | Market High Asking Rent | currency | 🔶 | Highest comp rent |
| O13 | Renovated Rent Target | currency | 🔶 | Expected post-reno rent |
| O14 | Rent Premium | currency | 📊 | `=O13-AVERAGE(J:J)` |
| O15 | Premium % | percentage | 📊 | `=O14/AVERAGE(J:J)` |

#### Table 4.4: Unit Type Legend (Cells N18:O22)

Static reference table for renovation classifications:
- Classic: Original condition
- Prior Upgrade (PU): Some updates
- Upgrade (U): Full renovation
- Elite (E): Premium finishes

---

## Sheet 5: Revenue

### Purpose
Projects revenue for 10 years based on rent growth assumptions, renovation schedule, and occupancy forecasts.

### Key Input Sections

#### Anticipated RUBS Income (Cells C6:D11)

| Cell | Label | Data Type | Source |
|------|-------|-----------|--------|
| D6 | Water/Sewer per Unit | currency | 🔶 |
| D7 | Trash per Unit | currency | 🔶 |
| D8 | Pest Control per Unit | currency | 🔶 |
| D9 | Package Hub per Unit | currency | 🔶 |
| D10 | Valet Trash per Unit | currency | 🔶 |

#### Unit Renovations Schedule (Cells B15:M20)

| Cell | Label | Data Type | Source |
|------|-------|-----------|--------|
| C15 | Renovation Start Month | number | 🔶 |
| C16 | Units per Month | number | 🔶 |
| D17-M17 | Monthly renovation count | number | 📊 |

#### Income Growth Assumptions (10-year projections)

| Row | Metric | Years 1-10 |
|-----|--------|------------|
| 25 | RUBS Growth % | 🔶 all years |
| 26 | Other Income Growth % | 🔶 all years |
| 27 | Rental Income Growth % | 🔶 all years |
| 28 | Vacancy % | 🔶 all years |
| 29 | Bad Debt % | 🔶 all years |
| 30 | Concessions % | 🔶 all years |

---

## Sheet 6: Expenses

### Purpose
Projects operating expenses for 10 years with detailed payroll assumptions and growth rates.

### Key Input Sections

#### T12 vs Year 1 Comparison (Cells B6:E18)

All expense categories with T12 actuals and Year 1 proforma assumptions.

#### Payroll Assumptions (Cells B22:H30)

| Position | Hourly Rate | Hours/Week | Annual Wages | Benefits | Total |
|----------|-------------|------------|--------------|----------|-------|
| Manager | 🔶 | 🔶 | 📊 | 📊 | 📊 |
| Asst Manager | 🔶 | 🔶 | 📊 | 📊 | 📊 |
| Maintenance | 🔶 | 🔶 | 📊 | 📊 | 📊 |
| Tech | 🔶 | 🔶 | 📊 | 📊 | 📊 |

#### Expense Growth Assumptions (Cells B35:L35)

| Metric | Year 1-10 |
|--------|-----------|
| Insurance Growth % | 🔶 |
| Payroll Growth % | 🔶 |
| R&M Growth % | 🔶 |
| Tax Reassessment Year | 🔶 |
| Tax Growth % | 🔶 |
| Other Expenses Growth % | 🔶 |
| Management Fee % | 🔶 |

---

## Sheet 7: CapEx

### Purpose
Capital expenditure budget for unit renovations and general property improvements.

### Key Input Sections

#### Unit Renovations by Type (Cells B6:H12)

| Column | Purpose |
|--------|---------|
| B | Unit Type (Classic, PU, U, Elite) |
| C | Available Units | 🔶 |
| D | Units to Renovate | 🔶 |
| E | Cost per Unit | 🔶 |
| F | Total Cost | 📊 |
| G | Expected Rent Premium | 🔶 |
| H | Renovation ROI | 📊 |

#### Renovation Cost Breakdown (Cells B15:D30)

Itemized costs per unit:
- Appliances, Flooring, Hardware, Cabinets, Backsplash, Counters
- Paint, Lighting, W/D Connections, Bathroom, Smart Home, Labor

#### General Improvements (Cells B35:D50)

Line items for common area improvements:
- Exterior repairs, Signage, Landscaping, Fitness center, etc.

---

## Sheet 8: Project Budget

### Purpose
Complete sources and uses of funds for the acquisition.

### Key Input Sections

#### Acquisition Costs (Cells B6:F15)

| Item | $/SF | $/Unit | Amount | Monthly |
|------|------|--------|--------|---------|
| Purchase Price | 📊 | 📊 | 🔶 | - |
| Seller Credit | - | - | 🔶 | - |
| Buyer Legal | - | - | 🔶 | - |
| Title Policy | - | - | 🔶 | - |
| Due Diligence | - | - | 🔶 | - |

#### CapEx Budget Summary (Cells B20:D25)

Links to CapEx sheet calculations.

#### Financing Costs (Cells B30:D40)

| Item | Amount |
|------|--------|
| Loan Origination | 🔶 |
| Lender Legal | 🔶 |
| Phase I/Appraisal | 🔶 |
| Broker Fee | 🔶 |
| Rate Lock | 🔶 |

---

## Sheet 9: Capital Stack

### Purpose
Defines the debt and equity structure for the acquisition.

### Key Input Sections

#### Loan Information (Cells B6:E20)

| Metric | Acquisition Loan | Refinance Loan |
|--------|------------------|----------------|
| Term (months) | 🔶 | 🔶 |
| Rate Index | 🔶 | 🔶 |
| Spread | 🔶 | 🔶 |
| Interest Rate | 📊 | 📊 |
| IO Period | 🔶 | 🔶 |
| Amortization | 🔶 | 🔶 |
| LTV | 🔶 | 🔶 |
| Min DSCR | 🔶 | 🔶 |
| Loan Amount | 📊 | 📊 |

#### Current Treasury Rates (Cells B25:C30)

| Term | Rate |
|------|------|
| 3-Year | 🔶 |
| 5-Year | 🔶 |
| 7-Year | 🔶 |
| 10-Year | 🔶 |

#### Sources & Uses Summary (Cells B35:D45)

All values flow from other sheets via formulas.

---

## Sheet 10: Cash Flows

### Purpose
Monthly and annual cash flow projections combining revenue, expenses, and debt service.

### Structure

This sheet is **almost entirely formula-based**, pulling from:
- Revenue sheet (income projections)
- Expenses sheet (expense projections)
- Capital Stack (debt service)
- CapEx (renovation timing)

### Key Formula Sections

| Section | Row Range | Source |
|---------|-----------|--------|
| Revenue Lines | 10-20 | 🔗 Revenue sheet |
| Expense Lines | 22-35 | 🔗 Expenses sheet |
| NOI | 37 | 📊 Revenue - Expenses |
| Debt Service | 40-45 | 🔗 Capital Stack |
| Net Cash Flow | 50 | 📊 NOI - Debt Service |

---

## Sheet 11: Waterfall

### Purpose
Calculates LP and GP returns based on equity structure and preferred returns.

### Key Input Sections

#### Equity & Waterfall Structure (Cells B6:D15)

| Metric | Value |
|--------|-------|
| Total Equity Invested | 🔗 from Capital Stack |
| LP Equity % | 🔶 |
| GP Equity % | 📊 |
| Preferred Return | 🔶 |
| Hurdle Rate | 🔶 |
| Share Split Tier 1 (LP/GP) | 🔶 |
| Share Split Tier 2 (LP/GP) | 🔶 |

#### Disposition Assumptions (Cells B20:D25)

| Metric | Value |
|--------|-------|
| Exit Month | 🔶 |
| Exit Cap Rate | 🔶 |
| Selling Costs % | 🔶 |
| Broker Fee % | 🔶 |

### Calculations

All return calculations are formula-driven:
- IRR (LP, GP, Project)
- Equity Multiple
- Cash on Cash by Year

---

## Sheet 12: Investment Summary

### Purpose
Executive summary aggregating key metrics from all other sheets with investment decision scoring.

### Key Sections

#### Property Description (Cells B6:C16)
Links to Property Summary sheet.

#### Investment Returns (Cells H6:I15)

| Metric | Source |
|--------|--------|
| Total Equity | 🔗 Capital Stack |
| Total Return | 🔗 Waterfall |
| Equity Multiple | 🔗 Waterfall |
| IRR | 🔗 Waterfall |
| Avg Cash on Cash | 🔗 Cash Flows |

#### Investment Rating Scorecard (Cells B30:R40)

Weighted scoring similar to Demos sheet:
- Property Rating Score (from Demos)
- Year 1 Cash on Cash
- Average Cash on Cash
- Investor IRR
- Investor Equity Multiple

#### Investment Decision (Cells B45:D47)

| Score Range | Decision |
|-------------|----------|
| ≥ 7.0 | Submit LOI |
| ≥ 6.0 | Take a Deeper Dive |
| < 6.0 | Don't Submit LOI |

---

## CoStar JSON Field Reference

### Available Fields from Docling Extraction

```json
{
  "structured_data[0]": {
    "property": {
      "no_of_units": 183,
      "stories": 2,
      "avg_unit_size": 863,
      "property_type": "Apartments - All",
      "rent_type": "Market",
      "year_built": 1985,
      "parking": 366,
      "name": "Serafina",
      "address": "11025 S 51st St",
      "city": "Phoenix",
      "state": "AZ"
    },
    "property_manager": {
      "name": "Western Wealth Communities - Serafina",
      "phone": "(623) 253-9106"
    },
    "owner": {
      "name": "Western Wealth Capital",
      "purchase_date": "Purchased Mar 2019",
      "purchase_price": "$27,450,000 ($150,000/Unit)",
      "purchase_price_raw": "27450000",
      "price_per_unit": "$150,000/Unit"
    },
    "asking_rents": {
      "current": { "per_unit": 1478, "per_sf": 1.71 },
      "last_quarter": { "per_unit": 1434, "per_sf": 1.66 },
      "year_ago": { "per_unit": 1455, "per_sf": 1.69 },
      "competitors": { "per_unit": 1492, "per_sf": 1.66 },
      "submarket": { "per_unit": 1747, "per_sf": 1.82 }
    },
    "vacancy": {
      "current": { "rate": 6, "units": 11 },
      "last_quarter": { "rate": 4.4, "units": 8 },
      "year_ago": { "rate": 7.7, "units": 14 },
      "competitors": { "rate": 7.9, "units": 433 },
      "submarket": { "rate": 8.6, "units": 949 }
    },
    "unitBreakdown[1].rows": [
      {
        "bed": 1,
        "bath": 1,
        "avgSf": 678,
        "unitMix.units": 48,
        "unitMix.mix%": 26.2,
        "availability.units": 3,
        "availability.mix%": 6.3,
        "avgAskingRent.perUnit": 1317,
        "avgAskingRent.perSf": 1.94,
        "avgEffectiveRent.perUnit": 1308,
        "avgEffectiveRent.perSf": 1.93,
        "concessions": 0.7
      }
    ]
  }
}
```

---

## Transform Functions Required

| Transform | Input | Output | Description |
|-----------|-------|--------|-------------|
| `divide_by_100` | 6.0 | 0.06 | Convert whole % to decimal |
| `to_number` | "$27,450,000" | 27450000 | Strip currency formatting |
| `years_since_purchase` | "Purchased Mar 2019" | 6 | Calculate years since purchase |
| `extract_property_name` | "Serafina 183 Unit..." | "Serafina" | Extract name before unit count |
| `extract_city` | "Phoenix, Arizona - ..." | "Phoenix" | Extract city from location |
| `extract_state_abbrev` | "Phoenix, Arizona - ..." | "AZ" | Convert state to abbreviation |
| `bed_bath_label` | {bed: 2, bath: 1} | "2B/1Ba" | Create unit type label |
| `calc_occupied` | {units: 48, avail: 3} | 45 | Subtract available from total |

---

## Appendix A: Cell Reference Quick Lookup

### Property Summary
| Data | Cell |
|------|------|
| Property Name | C6 |
| Address | C7 |
| City | C8 |
| State | C9 |
| Total Units | F6 |
| Avg SF | F7 |
| Vacancy % | F8 |
| Year Built | C13 |
| T12 Revenue | I6 |
| T12 Expenses | I7 |
| Guidance Price | I10 |

### Unit Mix (Row Template, starting Row 7)
| Data | Column |
|------|--------|
| Unit Type | B |
| Avg SF | C |
| Units | D |
| Occupied | E |
| Unit Mix % | G |
| Asking Rent | H |
| Effective Rent | J |


