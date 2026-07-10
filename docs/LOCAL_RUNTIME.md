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
        "walkScore": { "walk_score": 72, "transit_score": 48 }
      }
    ]
  }
}
```

The importer retains source and as-of provenance. When no record matches a
property, scoring reports that the local reference metrics are unavailable; it
does not fetch a replacement.
