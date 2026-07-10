# Local runtime

Serafina is a loopback-only, local-first application. Its normal runtime makes
no internet requests and has no cloud database or document-processing endpoint.

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

Normal extraction processes only the first 10 pages of an uploaded PDF. CoStar
property identity, ownership, unit mix, rents, vacancy, and amenities are in
this leading summary; the much larger comparable and market-report appendices
are not sent through Docling. Before the expensive document models run, a cheap
native-text pass examines up to 10 pages and stops on the page where the full
subject-property field set is complete: property identity and location,
management, ownership and purchase history, unit mix, asking and effective
rents, vacancy, absorption, site and unit amenities, one-time expenses, and pet
policy. Value-bearing identity, sale-price, and unit-mix rows are required in
addition to their headings. The current Serafina and Hawks Landing samples both
select pages 1-5;
a report that moves the final details to page 7 selects pages 1-7. If native
text cannot prove completeness, as with an unfamiliar or scanned layout, the
configured 10-page safety ceiling is used. Set `SERAFINA_MAX_PDF_PAGES` to an
integer from 4 through 10.

Demographic and submarket scoring inputs should be imported as local reference
data. When they are unavailable, scoring preserves that absence instead of
running the entire PDF or inventing replacement values.

<!-- TODO(local-runtime): When preparing the distributable installer, replace
this manual procedure with a signed offline wheelhouse and model/artifact bundle
that carries checksums. Keep the application runtime download-free. -->

## Local reference data

Live web scraping was intentionally removed. Import a JSON snapshot through
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
