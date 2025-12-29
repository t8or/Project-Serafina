# CoStar Data Coverage Checklist

**Purpose:** Quick reference for admins to know what data auto-fills from CoStar vs what needs manual entry.

---

## Auto-Fill from CoStar PDF (✅)

These fields are automatically populated when you run the Docling extraction on a CoStar property report.

### Property Summary Sheet

| Cell | Field | JSON Path | Status |
|------|-------|-----------|--------|
| C6 | Property Name | `property.name` | ✅ Auto |
| C7 | Street Address | `property.address` | ✅ Auto |
| C8 | City | `property.city` | ✅ Auto |
| C9 | State | `property.state` | ✅ Auto |
| C13 | Year Built | `property.year_built` | ✅ Auto |
| C16 | Management Company | `property_manager.name` | ✅ Auto |
| F6 | Total Units | `property.no_of_units` | ✅ Auto |
| F7 | Avg Unit Size (SF) | `property.avg_unit_size` | ✅ Auto |
| F8 | Current Vacancy | `vacancy.current.rate` | ✅ Auto |
| F10 | Floors/Stories | `property.stories` | ✅ Auto |
| C19 | Seller Name | `owner.name` | ✅ Auto |
| C20 | Ownership Duration | `owner.purchase_date` | ✅ Auto (calculated) |
| C21 | Last Sold Price | `owner.purchase_price_raw` | ✅ Auto |

### Unit Mix & Comps Sheet

| Column | Field | JSON Field | Status |
|--------|-------|------------|--------|
| B | Unit Type (e.g., 2B/1Ba) | `bed` + `bath` | ✅ Auto |
| C | Avg SF | `avgSf` | ✅ Auto |
| D | Units | `unitMix.units` | ✅ Auto |
| E | Occupied Units | Calculated | ✅ Auto |
| G | Unit Mix % | `unitMix.mix%` | ✅ Auto |
| H | Current Advertised Rent | `avgAskingRent.perUnit` | ✅ Auto |
| J | Average Effective Rent | `avgEffectiveRent.perUnit` | ✅ Auto |
| K | Price per SF | `avgAskingRent.perSf` | ✅ Auto |

---

## Manual Entry Required (🔶)

These fields are NOT available in CoStar property reports and must be entered manually.

### Property Summary Sheet - REQUIRED MANUAL ENTRY

| Cell | Field | Data Source | Priority |
|------|-------|-------------|----------|
| C10 | County | Geocoding / Manual | Medium |
| C11 | Zip Code | Geocoding / Manual | Medium |
| C12 | Land Area (Acres) | County Records | Low |
| C14 | Year Renovated | OM / Broker | Low |
| C15 | Management Type | Manual | Low |
| F9 | Building Count | OM / Manual | Medium |
| **I6** | **T12 Revenue** | **OM / Financials** | **HIGH** |
| **I7** | **T12 Expenses** | **OM / Financials** | **HIGH** |
| **I10** | **Guidance Price** | **Deal Terms** | **HIGH** |
| I13 | Call for Offers Date | Deal Terms | Medium |
| C22 | Why Selling? | Broker | Medium |
| C23 | Improvements Made | OM / Broker | Medium |
| C24 | What Matters to Seller | Broker | Medium |
| C25 | Broker Name | Deal Terms | Low |
| C26 | Brokerage | Deal Terms | Low |
| C27 | Broker Email | Deal Terms | Low |
| C28 | Broker Phone | Deal Terms | Low |

### Unit Mix & Comps - REQUIRED MANUAL ENTRY

| Column | Field | Data Source |
|--------|-------|-------------|
| F | Renovation Units | Property Inspection |
| O7 | Market Avg Asking Rent | Comp Analysis |
| O8 | Market Price per SF | Comp Analysis |
| O12 | Market High Rent | Comp Analysis |
| O13 | Renovated Rent Target | Pro Forma |

### Demos Sheet - ALL MANUAL ENTRY

| Cell | Field | Data Source |
|------|-------|-------------|
| C6-E6 | Population (1/3/5 mi) | CoStar Analytics |
| C7-E7 | Pop Growth (1/3/5 mi) | CoStar Analytics |
| C8-E8 | Median HH Income | CoStar Analytics |
| C9-E9 | Median Home Value | CoStar Analytics |
| C10-E10 | Renter % | CoStar Analytics |
| C12-D12 | Violent Crime | bestplaces.net |
| C13-D13 | Property Crime | bestplaces.net |
| C15-C16 | School Ratings | greatschools.org |
| C18-C19 | Walk/Transit Scores | walkscore.com |
| C21-C25 | Submarket Data | CoStar Analytics |

### Historical Financials - ALL MANUAL ENTRY

| Cell Range | Data | Source |
|------------|------|--------|
| C10-F18 | Revenue Lines | OM / Rent Roll |
| C20-F31 | Expense Lines | OM / Financials |

### Revenue Sheet - MANUAL ASSUMPTIONS

| Cell | Field | Notes |
|------|-------|-------|
| D6-D10 | RUBS per Unit | Market research |
| C15-C16 | Renovation Schedule | Business plan |
| C25-C30 | Growth Assumptions | Market research |

### Expenses Sheet - MANUAL ASSUMPTIONS

| Cell | Field | Notes |
|------|-------|-------|
| C22-H30 | Payroll Details | Market rates |
| C33-C38 | Tax Assessment | County records |
| C42-C48 | Growth Rates | Market research |

### CapEx Sheet - ALL MANUAL

All renovation costs and improvement budgets must be entered manually based on property inspection and contractor quotes.

### Project Budget - ALL MANUAL

All acquisition costs, financing costs, and fees are deal-specific.

### Capital Stack - ALL MANUAL

All loan terms, treasury rates, and equity structure are deal-specific.

### Waterfall - MANUAL INPUTS

| Cell | Field |
|------|-------|
| C7 | LP Equity % |
| C9 | Preferred Return |
| C10 | Hurdle Rate |
| C11-C12 | Share Splits |
| C20-C23 | Exit Assumptions |

---

## Pre-Fill Checklist by Data Source

### From CoStar Property PDF
- [ ] Property Name
- [ ] Street Address
- [ ] City, State
- [ ] Year Built
- [ ] Total Units
- [ ] Avg Unit Size
- [ ] Stories/Floors
- [ ] Current Vacancy Rate
- [ ] Owner Name
- [ ] Purchase Date/Price
- [ ] Property Manager
- [ ] Unit Mix Details (all unit types)
- [ ] Asking Rents by Unit Type
- [ ] Effective Rents by Unit Type

### From CoStar Analytics (Separate Export)
- [ ] Demographics (1/3/5 mile)
- [ ] Submarket Vacancy
- [ ] Submarket Rents
- [ ] Construction Pipeline

### From Offering Memorandum (OM)
- [ ] T12 Revenue Detail
- [ ] T12 Expense Detail
- [ ] Guidance Price
- [ ] Capital Improvements Made
- [ ] Seller Information

### From Broker/Deal Terms
- [ ] Call for Offers Date
- [ ] Seller Motivation
- [ ] Negotiation Points
- [ ] Broker Contact Info

### From Third-Party Sources
- [ ] Crime Statistics (bestplaces.net)
- [ ] School Ratings (greatschools.org)
- [ ] Walk Score (walkscore.com)
- [ ] Transit Score (walkscore.com)
- [ ] County Tax Records

### From Business Plan/Pro Forma
- [ ] Renovation Budget
- [ ] General Improvements Budget
- [ ] Growth Rate Assumptions
- [ ] Loan Terms
- [ ] Equity Structure
- [ ] Exit Assumptions

---

## Quick Stats

| Category | Count |
|----------|-------|
| Auto-fill from CoStar PDF | ~25 fields |
| Manual Entry Required | ~200+ fields |
| Formula Calculated | ~500+ cells |

**Key Insight:** CoStar PDF provides property basics and unit mix only. The majority of the underwriting model requires external data sources.

---

## Workflow Recommendation

1. **Start with CoStar PDF extraction** - Get basic property data and unit mix
2. **Request CoStar Analytics export** - Get demographics and submarket data
3. **Obtain OM from broker** - Get T12 financials and seller information
4. **Research third-party sources** - Crime, schools, walk scores
5. **Develop business plan** - CapEx budget, growth assumptions
6. **Input deal terms** - Loan structure, equity split, exit assumptions
7. **Review calculated outputs** - Verify formulas are working correctly


