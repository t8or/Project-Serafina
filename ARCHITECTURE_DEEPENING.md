# Architecture Deepening — Project Serafina

Tracking plan for the 7 deepening candidates from the architecture review.
Vocabulary: **module**, **interface**, **depth**, **deep**, **shallow**, **seam**, **adapter**, **leverage**, **locality**.

**Session started:** 2026-07-08  
**Do not rewrite (already deep enough):** ScoringService core algorithm, PropertyService, DoclingBridge/XLSXBridge, ScraperService, AddressExtractor, docling_full_processor.py

---

## Dependency graph

```
#7 Fix scorecard config seam (quick wins)
        │
        ▼
#1 Split CoStarExtract out of scoringHandler
        │
        ▼
#2 One PropertyDataAssembler + shared ScoringService factory
        │
        ├──────────────┐
        ▼              ▼
#6 Delete dead     #3 ExtractionPipeline
   FileProcessor       (builds on #1+#2)
   bulk + shallow
   wrappers
        │
        ▼
#5 Retire dual Property identity
   (needs solid assembler + backfill)

#4 Bridge docling_full → XLSX fill
   (more independent; lower priority after core)
```

**Implementation order:** #7 → #1 → #2 → #6 → #3 → #5 → #4

---

## Completed vs pending checklist

| # | Candidate | Status |
|---|-----------|--------|
| 7 | Fix scorecard config seam | ✅ Done |
| 1 | Split CoStarExtract out of scoringHandler | ✅ Done |
| 2 | One PropertyDataAssembler + shared ScoringService factory | ✅ Done |
| 6 | Delete dead FileProcessor bulk + shallow wrappers | ✅ Done |
| 3 | Extraction pipeline module | ✅ Done |
| 5 | Retire dual Property identity | ✅ Done (legacy gated, not fully erased) |
| 4 | Bridge docling_full → XLSX fill | ✅ Done (adapter + linkGeneratedFile; transformer quality follow-up) |

---

## Candidate plans

### 1. Split CoStarExtract out of scoringHandler — Strong

**Problem**  
`extractDemographicsFromDocling` / `extractSubmarketFromDocling` / helpers (~443 lines) and `SECTION_TYPES` live in `src/api/scoringHandler.js`. `extractHandler.js` imports parsers from the HTTP handler — wrong seam direction (HTTP adapter → domain logic inverted).

**Target module / interface**  
- Module: `src/services/costar_extract.js` (deep CoStarExtract)
- Interface:
  - `SECTION_TYPES` (canonical list)
  - `extractDemographicsFromDocling(demographicsSection, submarketSection)`
  - `extractSubmarketFromDocling(submarketSection, constructionSection, demographicsSection?)`
  - `extractPropertyMetricsFromDocling(subjectPropertySection)`
  - Shared parse helpers: `parseMarkdownTable`, `findTableValue`, `parseNumericValue`

**Files touched**  
- Create: `src/services/costar_extract.js`
- Update: `src/api/scoringHandler.js` (import; remove local defs; keep HTTP only)
- Update: `src/api/extractHandler.js` (import from costar_extract, not scoringHandler)
- Update: `scripts/backfill_properties.js` (import `SECTION_TYPES` if useful)

**Acceptance criteria**  
- [x] No domain extract logic remains in scoringHandler
- [x] extractHandler does not import from scoringHandler
- [x] Rescore / properties-fallback / extract still produce same shaped demographics/submarket/property objects
- [x] SECTION_TYPES defined once

**Status:** Done

---

### 2. One PropertyData assembler — Strong

**Problem**  
Four assembly copies: extractHandler `linkExtractionToProperty`, scoringHandler `/rescore` + `/properties` fallback, `scripts/backfill_properties.js` stub (`buildPropertyDataForScoring`). Three `new ScoringService()` sites; only scoringHandler loads saved config → extract/backfill score with defaults.

**Target module / interface**  
- Module: `src/services/property_data_assembler.js`
- Interface:
  - `assemblePropertyData(sections, address, external?)` → `{ address, demographics, property, submarket, external }`
  - `getScoringService()` → singleton ScoringService that loads `uploads/config/scorecard_config.json` once

**Files touched**  
- Create: `src/services/property_data_assembler.js`
- Update: `src/api/extractHandler.js`, `src/api/scoringHandler.js`, `scripts/backfill_properties.js`

**Acceptance criteria**  
- [x] Single assemble function used by extract, rescore, properties-fallback, backfill
- [x] Shared getScoringService() loads saved config (or defaults if missing)
- [x] No duplicate demographics/submarket wiring at call sites

**Status:** Done

---

### 3. Extraction pipeline module — Worth exploring

**Problem**  
`extractHandler.js` owns Docling → address → scrape → link → score orchestration mixed with HTTP validation. Hard to test; shallow HTTP adapter.

**Target module / interface**  
- Module: e.g. `src/services/extraction_pipeline.js`
- Interface: `run({ fileId, processor })` — owns full pipeline; handler only validates HTTP and calls `run`.

**Files touched**  
- Create: `src/services/extraction_pipeline.js`
- Update: `src/api/extractHandler.js` (thin)

**Depends on:** #1, #2

**Acceptance criteria**  
- [x] Handler validates request + returns response only
- [x] Pipeline owns Docling → address → scrape → link → score
- [x] Uses CoStarExtract + PropertyDataAssembler

**Status:** Done — `src/services/extraction_pipeline.js` (`run`, `scrapeByBaseName`, `checkDoclingAvailability`); `extractHandler.js` is thin HTTP.

---

### 4. Bridge docling_full → XLSX fill — Worth exploring

**Problem**  
`field_mappings.json` expects `structured_data[0]`; docling_full writes section files. Fill path cannot consume full-section output. Need PropertyExtract adapter + `linkGeneratedFile` from fill path.

**Target module / interface**  
- Module: `src/services/property_extract_adapter.js`
- Interface: `assembleFillPayload(sections)`, `assembleFillPayloadFromBaseName(dir, baseName)`, `loadSectionsFromDir`
- Seam: fillHandler → adapter → XLSXBridge; PropertyService.linkGeneratedFile on success when propertyId known

**Files touched**  
- Create: `src/services/property_extract_adapter.js`
- Update: `src/api/fillHandler.js` (baseName/propertyId sources, linkGeneratedFile, CONFIG/UPLOADS path fixes)

**Depends on:** Prefer after #2 (assembler locality); can proceed independently

**Acceptance criteria**  
- [x] docling_full section set → `structured_data[0]` via adapter (reuses DoclingTransformer; no synthetic data)
- [x] Generated XLSX linked via `linkGeneratedFile` when `propertyId` resolved
- [x] No synthetic/mock structured_data
- [ ] Follow-up: transformer field quality on section-only input (e.g. property.name sometimes "SUBJECT PROPERTY"; vacancy may be null) — improve locality of fill mapping later

**Status:** Done (core seam); quality polish open

---

### 5. Retire dual Property identity — Worth exploring

**Problem**  
PropertyService is deep but not sole facade: file-scan fallback on GET `/properties` and `e_*` string IDs remain. Dual identity confuses dashboard/scoring.

**Target module / interface**  
- PropertyService remains the sole property facade
- File-scan gated behind `?source=files` (deprecated), not automatic
- Empty DB returns graceful message (no silent e_* list)
- DELETE prefers DB ids; resolves `e_*` via extracted_files when possible

**Files touched**  
- `src/api/scoringHandler.js`
- `src/api/propertyHandler.js`
- `scripts/backfill_properties.js` (already uses assembler)

**Depends on:** #2 (assembler), solid backfill

**Acceptance criteria**  
- [x] GET `/properties` default is DB-only; empty DB → message pointing at backfill (no auto file-scan)
- [x] File-scan only via `?source=files` with `deprecated: true`
- [x] DELETE resolves `e_*` → property_id when linked; else deprecated file delete
- [ ] Full erasure of e_* UI paths still needs dashboard audit after backfill is routine

**Status:** Done (gated dual identity; not fully erased)

---

### 6. Delete dead FileProcessor bulk + shallow wrappers — Speculative

**Problem**  
~620 dead lines in `file_processor.js`; shallow DoclingProcessor/DoclingFullProcessor/XLSXProcessor pass-throughs; stale `init-db.js`.

**Target**  
- Verify with grep that callers are gone
- Delete clearly unused code paths (candidate #6 is explicit deletion)
- Prefer comment-out only if uncertain

**Files touched**  
- `src/services/file_processor.js` (slimmed to process_file + routing; DoclingBridge via local adapters)
- `src/services/processors/docling_bridge.js` / `xlsx_bridge.js` (shallow wrappers removed)
- `src/config/init-db.js` → thin CLI calling `database.js` `initDb`
- `.cursor/rules/start-server.mdc` updated

**Depends on:** Prefer after #2 so extract/score paths are stable; verify before delete

**Acceptance criteria**  
- [x] Grep showed zero external callers for processPDF/Image/CSV/Excel, extractPropertyData, breakPDFIntoSections, extractTables
- [x] Live path remains `process_file` → specialized processors / DoclingBridge
- [x] No broken imports (XLSXBridge / DoclingBridge direct)

**Status:** Done

---

### 7. Fix scorecard config seam — Strong

**Problem**  
1. scorecard-config "Re-run All Scores" calls GET `/properties` (read-only list) instead of POST `/rescore` (persist recalculation).
2. Three ScoringService instances; only scoringHandler loads config (addressed with #2 factory).
3. Delivered % has `lowerIsBetter: false` but threshold ladder is lower-is-better shaped (bug).
4. Debug `fetch` to `127.0.0.1:7243` in `scoring_service.js`.

**Target**  
- Correct polarity + strip debug in ScoringService defaults
- Wire UI to POST `/api/scoring/rescore` (batch already exists — rescored all DB properties)
- Shared factory in #2 for config locality

**Files touched**  
- `src/services/scoring_service.js`
- `src/scorecard-config.html`
- (config factory via #2)

**Acceptance criteria**  
- [x] `submarketDeliveredPercent.lowerIsBetter === true` with updated comment
- [x] No debug ingest fetches to 127.0.0.1:7243
- [x] Re-run All Scores → POST `/api/scoring/rescore`; shows rescored count / errors
- [x] Decision noted: polarity assumed underwriting-correct (lower delivery = less oversupply risk)

**Status:** Done

---

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-08 | Delivered % → `lowerIsBetter: true` | Threshold ladder already ascending (2.5%→10 … 7.0%→1). Parallel to Construction %. Underwriting default: lower delivery = less oversupply risk. **Needs user confirmation if business wants higher-delivery-as-strength.** |
| 2026-07-08 | POST `/rescore` already batch-rescored all DB properties | No new batch endpoint; UI just calls existing contract. |
| 2026-07-08 | CoStarExtract includes property metrics + parse helpers | Same locality as demographics/submarket; all Docling table parsing in one deep module. |
| 2026-07-08 | `getScoringService()` lives in property_data_assembler.js | Keeps “assemble + score with same config” locality; scoringHandler migrates to factory instead of local singleton+loadSavedConfig. |
| 2026-07-08 | No commit this session | User did not ask for commits. |
| 2026-07-08 | #6 deletion only after grep-verified dead callers | User rule: never delete unless sure; candidate #6 is explicit but still verify. |
| 2026-07-08 | #6: remove dead FileProcessor bulk; keep process_file | Grep: only process_file used externally; specialized processors already own CSV/Excel/PDF/Image. |
| 2026-07-08 | Drop shallow DoclingProcessor/XLSXProcessor | Deletion test: FileProcessor/fillHandler call bridges directly. |
| 2026-07-08 | init-db.js → CLI over database.initDb | Stale duplicate CREATE TABLE removed; start-server rule notes schema locality. |
| 2026-07-08 | #5: gate file-scan, don’t auto-fallback | Empty DB must not invent e_* identity; `?source=files` emergency only. |
| 2026-07-08 | #4: reuse DoclingTransformer for fill | No invented structured_data; prefer subject_property (+ rent_comps) sections to avoid construction header pollution. |
| 2026-07-08 | .venv python symlink broken in this env | Adapter falls back to `python3`; DoclingBridge still points at `.venv` — fix venv separately. |

---

## Session progress notes

### Implemented (all 7 candidates)
- Tracking file created
- **#7:** Delivered % polarity, debug strip, Re-run → POST `/rescore`
- **#1:** `src/services/costar_extract.js`
- **#2:** `src/services/property_data_assembler.js`
- **#6:** Slimmed `file_processor.js`; removed shallow Docling/XLSX wrappers; `init-db.js` CLI → `initDb`
- **#3:** `src/services/extraction_pipeline.js`; thin `extractHandler.js`
- **#5:** DB-default `/properties`; deprecated `?source=files`; DELETE resolves `e_*` via DB when possible
- **#4:** `src/services/property_extract_adapter.js`; fillHandler `baseName`/`propertyId` + `linkGeneratedFile`

### Open follow-ups (not blockers for seams)
- Delivered % business polarity confirmation
- PropertyExtract fill quality (name/vacancy) when transformer runs on section JSON
- Repair `.venv` Python symlink (points at missing homebrew 3.14)
- Dashboard still may send `e_*` delete ids until UI fully on numeric property ids
- Run `scripts/backfill_properties.js` so DB is sole identity in practice

### Still pending
- None of the 7 candidates remain unimplemented; follow-ups above are polish/ops
