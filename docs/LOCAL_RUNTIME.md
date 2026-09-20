# Local runtime

Serafina is a loopback-only, local-first application. Its normal runtime makes
no internet requests and has no cloud database or document-processing endpoint.
Optional [online testing](HOSTING.md) adds Cloudflare Tunnel, Access verification,
and a cloud ownership coordinator while keeping document processing local.

## Commands

```sh
npm run local:setup
npm run local:doctor
npm run local:start
```

`local:setup` creates the SQLite database and local data directories. It never
downloads Python packages, Docling artifacts, or Ollama models. `local:doctor`
checks the destination-machine provisioning and exits non-zero until it is
complete. `local:start` refuses to listen until the same checks pass.

## Data location

By default, mutable state is stored at:

```text
~/Library/Application Support/Project Serafina
```

Override it with `SERAFINA_DATA_DIR` when required. Do not point it at iCloud,
Dropbox, a network share, or the source checkout. It contains the SQLite
database and related files that must remain on one local filesystem.

## Destination-machine provisioning

1. Use Node 26 Current and create a Python environment at `SERAFINA_PYTHON`.
2. Install Tesseract as a system package (`brew install tesseract` on macOS),
   then install the pinned Python package versions from `requirements.txt`.
3. Download Docling artifacts to `SERAFINA_DOCLING_ARTIFACTS_PATH`. The required
   pipeline families are listed in `config/local-runtime-models.json`. Create a
   `serafina-artifacts.manifest.json` in that directory and checksum every file:

   ```json
   {
     "version": 1,
     "files": [{ "path": "relative/artifact.bin", "sha256": "64-lowercase-hex-characters" }]
   }
   ```

   The runtime verifies this manifest and sets the Hugging Face/Transformers
   offline flags for Docling. It refuses an empty or incomplete artifact cache.
4. Pull the exact local Ollama model named by `SERAFINA_OLLAMA_MODEL`.
5. Run `npm run local:doctor` until every check passes.

## PDF processing boundary

Every page receives native-text inventory and Docling layout/OCR/table processing.
`SERAFINA_DOCLING_BATCH_PAGES` controls resumable batch size (4–64, default 32),
not a report page limit. Verified batches are reused after interruption or retry.
`SERAFINA_OCR_ENGINE=easyocr` is the benchmarked default; `ocrmac` is available on
macOS. Pipeline identity records the engine and package/OS versions. The legacy
`SERAFINA_MAX_PDF_PAGES` variable remains a batch-size alias only.

Scoring is a separate projection of retained evidence. Missing facts remain
missing; CoStar does not supply every crime, school, transit, or financial input.
See [the performance record](PERFORMANCE.md) and [evidence decision](adr/0001-retain-complete-report-evidence.md).

<!-- TODO(local-runtime): When preparing the distributable installer, replace
this manual procedure with a signed offline wheelhouse and model/artifact bundle
that carries checksums. Keep the application runtime download-free. -->

## Local reference data

Extraction remains local. **Complete inputs** on a property opens
`reference-inputs.html?property=<id>`. Paste a public Zillow apartment listing URL
to read published Walk Score, Transit Score, and the mean of rated, assigned public
schools. The reader checks the listing's street, city, and state against the
property before returning draft values. It needs no account or API key. Missing
values remain blank; blocked pages and layout changes produce an explicit error.

The form also accepts sourced manual values. Crime uses the BestPlaces ZIP-code
1–100 index, not city data or incidents per population. Renter households requires
the existing 3-mile geography. Each value retains its source URL, checked date,
scope, and notes. Saving creates a reference snapshot and recalculates the
assessment atomically; subsequent rescoring and property workbook generation use
the saved values. Concurrent edits require a reload rather than overwriting newer
inputs.

Agent/API workflow: `GET /api/reference-data/properties/:id` returns observations
and the current `snapshotId`/`revisionId`. `POST .../:id/read-listing` accepts
`{"url":"https://www.zillow.com/apartments/..."}` and returns draft observations.
`POST .../:id` saves `{observations,snapshotId,revisionId}`. Observation keys are
`renterHouseholdsPercent`, `violentCrimeRate`, `propertyCrimeRate`, `schoolRatings`,
`walkScore`, and `transitScore`; use `null` to remove a value. Each observation
contains `value`, `sourceUrl`, `observedAt`, `scope`, and optional `notes`. This is
an explicit lookup, not a background crawler; it does not bypass access controls.

For bulk local datasets, import supplemental values through
`POST /api/reference-data/import` with this shape:

```json
{
  "snapshot": {
    "source": "Licensed local dataset",
    "asOf": "2026-07-01",
    "records": [
      {
        "address": {
          "street": "123 Main St",
          "city": "Phoenix",
          "stateAbbr": "AZ",
          "zipCode": "85001"
        },
        "crime": { "violent_crime_index": 12 },
        "schools": { "average_rating": 8 },
        "walkScore": { "walk_score": 72, "transit_score": 48 },
        "demographics": {
          "population_3mile": 54321,
          "population_growth_3mile": 0.012,
          "median_hh_income_3mile": 65000,
          "median_home_value_3mile": 280000,
          "renter_households_pct_3mile": 0.38
        },
        "submarket": {
          "vacancy_rate": 0.074,
          "delivered_pct_of_inventory": 0.018,
          "construction_pct_of_inventory": 0.026
        }
      }
    ]
  }
}
```

The importer retains source and as-of provenance. When no record matches a
property, scoring reports that the local reference metrics are unavailable; it
does not fetch a replacement.
