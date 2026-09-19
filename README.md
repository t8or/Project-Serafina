# Project Serafina

Local CoStar report ingestion, inspectable evidence, property scoring, and underwriting workbook drafts. The product uses Express, SQLite, Python/Docling, Ollama, and the existing Webpack/Alpine interface.

## Run

Requirements: Node 26, a provisioned Python environment, local Docling artifacts with their checksum manifest, and Ollama with the configured model.

```sh
npm ci
cp .env.example .env
# Set the local Python and artifact paths in .env.
ollama pull qwen2.5:7b   # Only if not already installed.
npm run local:setup
npm run local:doctor
npm start
```

The default address is `http://127.0.0.1:3000`. `/reports.html` provides whole-report search, questions, JSON export, and table-cell CSV export. `/file-upload.html` starts durable extraction jobs. `/dashboard.html` provides the existing property workflows.

Keep mutable data outside the checkout and outside synced storage. On macOS the default is `~/Library/Application Support/Project Serafina`. `.env` is local machine configuration and is not versioned. The September robustness branch uses a separate `Project Serafina Audit` data directory and port 3011; it does not change the original data.

`SERAFINA_MAX_PDF_PAGES` is the historical name for **pages per batch**, now defaulting to 8. It accepts 4–10. It never truncates a Report. Every page receives native-text inventory and Docling layout/OCR/table processing. Cold runs take longer than retries; validated batches are reused.

## Evidence and readiness

- Original PDFs, page text, table cells, duplicate column labels, coordinates, and full Docling batch representations are retained locally. JSON export includes all captured pages and tables; original PDFs remain necessary for images and visual verification.
- Each Report revision has a source hash, pipeline fingerprint, coverage, and a frozen scoring projection. Old evidence is retained when current property references change.
- Coverage measures processing, **not semantic correctness**. Image-only pages without readable text, failed batches, and table failures remain visible. Unsupported or encrypted inputs fail visibly.
- Questions with recognized demographic metrics and explicit radii use exact table headings. Other questions use the local model and checked verbatim quotations. Generated interpretations remain drafts; quotation matching does not certify reasoning or OCR accuracy.
- Scores require valid inputs for every positively weighted factor. Unknown inputs produce `Insufficient data`, never an investment rejection. CoStar does not supply every crime, school, transit, or financial input; use the existing reference-snapshot workflow for those facts.
- Workbook exports are **drafts**. Mapped sample inputs are cleared when unsupported. Actual occupancy and achieved rents require rent-roll evidence; availability and effective asking rent are not substitutes. Unmapped template assumptions still require review. Formulas are preserved, and Excel recalculation remains required.

The bundled underwriting template has a versioned, checksum-bound mapping. A changed workbook must have its mapping reviewed before filling. A populated file is reopened to verify written cells and formulas before publication, and existing artifacts cannot be overwritten.

## Interfaces for other uses

| Request | Purpose |
| --- | --- |
| `POST /api/upload` (multipart `files`) | Store original PDF files |
| `POST /api/extract/:fileId` | Return HTTP 202 and a durable job ID |
| `GET /api/extract/jobs/:jobId` | Read queued/running/completed/partial/failed/interrupted status and progress |
| `GET /api/reports` | List retained revisions |
| `GET /api/reports/:id` | Inspect coverage |
| `GET /api/reports/:id/export` | Export whole-report JSON |
| `GET /api/reports/:id/export?format=csv` | Export table cells with page, row, column, and original heading |
| `GET /api/reports/:id/search?q=...` | Retrieve source passages and table evidence |
| `POST /api/reports/:id/ask` with `{ "question": "..." }` | Ask the retained Report |
| `POST /api/fill/template` with `{ "fileId": 1, "templatePath": "Serafina UW Phoenix AZ Feb 14 2025.xlsx" }` | Produce a verified workbook draft from a coherent revision |

A restart marks unfinished jobs interrupted. Submit the same file again to resume verified checkpoints. A process lock enforces one writer per data directory. Filesystem/process work happens outside short synchronous SQLite transactions. Late rescoring cannot overwrite a newer Report revision.

## Validate

```sh
npm test                    # Node and Python adversarial/regression suites
npm run build               # Production build
npm audit                   # Dependency advisories
npm run local:doctor        # Python, artifacts, model, and local paths
npm run dev                 # Loopback Webpack dev server; start backend separately
```

Opt-in integration checks use an isolated local data directory. `scripts/verify-local.js` expects the two bundled PDFs and the scanned fixture from `scripts/create-adversarial-fixtures.py` already extracted; it verifies the running HTTP interfaces, local inference, source hashes, and actual workbook cells. `scripts/verify-recovery.py` creates a temporary 24-page fixture, interrupts Docling after eight pages, and verifies resumed completion without recomputing that checkpoint. Set `DOCLING_ARTIFACTS_PATH` when running it directly with the provisioned Python.

See [CONTEXT.md](CONTEXT.md), [the evidence decision](docs/adr/0001-retain-complete-report-evidence.md), and [the audit and validation record](docs/ROBUSTNESS_AUDIT.md). Historic documents describe earlier summary-only behavior and are superseded where they conflict with that decision.
