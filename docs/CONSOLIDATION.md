# Main consolidation — September 19, 2026

## Canonical runtime

- Source: `main` in the original Project-Serafina checkout.
- Application: `http://127.0.0.1:3000`.
- Data: `~/Library/Application Support/Project Serafina`.
- Model: local `gemma4:12b`; EasyOCR and 32-page resumable batches retained.
- Hosting: `npm run host:start` supervises this same application, the authenticated gateway on 3012, and tunnel metrics on 3014. Those supporting ports are not separate applications. Port 3011 is retired.
- The Cloudflare hostname and access restrictions are unchanged. Hosting credentials and machine `.env` are not tracked in Git.

GitHub `main` already contained commits through `3f5bc8c`; the local checkout had been five commits behind. The consolidation merges that history with the assessment redesign. No feature branch replaces `main`.

## Preserved and integrated features

Complete report retention, durable extraction jobs and recovery, benchmarked local inference, validated source quotations, demographic table lookup, evidence search, PDF/JSON/CSV export, stricter score eligibility, workbook generation, encrypted workspace transfer, and authenticated hosting are retained.

The report screen now shares the assessment shell, appearance controls, typography, and restrained styling. Property review and original files link directly to their report. Missing contextual matches require explicit selection rather than silently answering from another file. Switching reports clears question/search state and rejects stale results or failures from prior requests. Processing timing is available in a disclosure.

The current scoring implementation withholds a final score when enabled factors lack valid inputs. This supersedes the older preview's zero-point treatment. Unscored properties remain visible in lists, filters, and portfolio totals.

## Data reconciliation

The old workspace contained five upload records representing two unique PDFs. SHA-256 comparison found both originals unchanged in the newer workspace. Neither workspace had custom scorecard settings or reference snapshots. The newer complete evidence therefore became canonical; older partial extraction output was archived instead of being allowed to replace it.

Preserved from the newer workspace: four source-file records (including two existing validation fixtures), three properties, 17 report revisions, 103 extraction records, 24 generated workbooks, and all job history. All nine database tables were compared row-for-row after transfer. Database integrity and foreign-key checks passed. Every referenced file was verified against the former workspace; all 24 saved workbook ZIP archives passed integrity checks.

Recovery copies of both databases, uploads, local settings, and uncommitted files are under `~/Library/Application Support/Serafina Backups/20260919-182742-consolidation`. The older partial uploads were also moved there before activating the newer uploads. Models and the Python environment retain their existing canonical paths.

## Verification

- Production Webpack build passed.
- 43 Node tests and 31 Python tests passed, covering report context, stale responses, null scores, gray portfolio counts, upload retries, extraction, workbooks, workspace archives, and hosting safeguards.
- Local readiness passed for Node, Python, 47 model artifacts, EasyOCR, Docling, and Gemma 4.
- Live retained evidence: 152 Serafina pages and 127 Hawks Landing pages, complete coverage, original-PDF hashes verified, JSON and CSV exports available.
- Live demographic questions returned $80,544 and $53,216 with citations from the correct reports.
- Live model-backed question returned the scanned report's 317 kW solar capacity with a validated quotation, using `gemma4:12b`.
- Browser verified assessment → matching report, question/quotation/table rendering, evidence search, report switching, and responsive styling.
- Managed-host status confirms the canonical checkout and data directory, valid lease, and ready tunnel. Only one application listener remains, on port 3000.

No new extraction jobs or workbooks were created by consolidation validation. Existing fixtures and historical revisions were preserved.
