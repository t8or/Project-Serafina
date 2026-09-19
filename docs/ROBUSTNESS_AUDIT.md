# Report robustness audit — September 19, 2026

The isolated branch `codex/serafina-report-robustness` changes ingestion from a small scoring extract into a retained, inspectable Report with separate business projections. Existing source PDFs, mutable production data, and uncommitted work in the original checkout were not changed. The audit runtime uses port 3011 and a separate local data directory.

## Findings and repairs

| Failure found | Resulting behavior |
| --- | --- |
| Whole reports were limited to an initial page batch; native scoring enrichment replaced richer sections | Every page is inventoried and processed in bounded batches. Full Docling representations, page text, ordered cells, duplicate headings, and source identity remain available. |
| Section recognition could mistake internal headings and table-of-contents mentions for new report sections | Cover-aware scope recognition keeps Subject Property, comparable properties, Submarket, and Market evidence distinct. Unclassified evidence remains retained. |
| Merged cover lines lost city/state; arbitrary five-digit values could become ZIP codes | Identity parsing handles merged cover text, recognizes actual states, and requires address or field-label context for ZIP codes. |
| Parsing could take a neighboring radius, discard negative signs, turn missing values into zero, or hide conflicts | Explicit headings and periods select values. Conflicts and missing geographies are withheld from scoring; alternative evidence remains inspectable. |
| Long extraction requests were fragile and interrupted work restarted | HTTP 202 durable jobs, one extraction writer, progress, checksum-validated batch reuse, explicit interruption status, and bounded subprocess lifetime. |
| Independent database writes could mix extraction generations | Short synchronous transactions publish document, current sections, immutable revision, frozen projection, and score together. Stale rescoring is rejected. |
| Missing crime, school, transport, and other inputs looked like investment rejection | Missing positively weighted factors or incomplete extraction produce `Insufficient data` and no numeric score. They are excluded from rejection counts. |
| A live model answer selected the 5-mile income despite correctly quoting the requested table | Recognized demographic radius questions use deterministic header-matched cells. Other local answers require exact retained quotations and remain explicitly draft interpretations. |
| Workbook paths, subject/comparable confusion, duplicate floor plans, row gaps, and sample values could corrupt outputs | Known template checksum and versioned mappings; subject-only projection; preserved distinct floor plans; unit-count reconciliation; missing sample inputs cleared; overflow rejected; formulas and written values verified after reopening. |
| Asking/effective rents and availability could be mistaken for achieved rent and occupancy | Unsupported achieved rent and occupancy remain empty. Workbook markers and a review sheet identify missing rent-roll evidence, external data, and unrecalculated formulas. |
| Deleting loose files could unlink source evidence before foreign-key rejection; property deletion left new revisions behind | Referenced source/section deletion returns conflict before touching files. Permanent property deletion removes its revisions and unshared artifacts while preserving shared sources and caches. |
| Dependencies contained reported advisories | Updated dependencies and lockfile, removed unused packages, and verified production and development builds. |

The architectural boundary is the Report evidence store. Scoring, workbook filling, search, questions, and future applications consume that store or its explicit projections. New uses need not repeat PDF extraction to access fields outside today's scorecard.

## Executed validation

The two repository PDFs were processed end to end, not just sampled:

| Source | Pages retained and processed | Tables retained |
| --- | ---: | ---: |
| Hawks Landing CoStar.pdf | 127 | 170 |
| Serafina CoStart Report.pdf | 152 | 207 |
| Total | 279 | 377 |

Both Reports completed structural processing with no recorded table extraction failures. Original downloads were verified against source SHA-256 hashes. All exported tables retained ordered cells and structural table data. This measures processing coverage; it does not establish perfect semantic extraction of every cell or chart.

A synthetic two-page image-only PDF had no native text. OCR retained an unfamiliar field, `solar capacity 317 kW`; search retrieved it and actual local Ollama inference answered with a checked source quotation. A deliberately malformed PDF failed extraction without publishing a revision. A real 24-page Docling run was terminated after its first eight pages, then resumed to completion while preserving that checkpoint's modification time.

Generated workbooks were independently reopened and checked against labeled source values:

| Fact | Hawks Landing | Serafina |
| --- | ---: | ---: |
| Property units and sum of detailed floor plans | 144 | 183 |
| Current vacancy | 9.7% | 6.0% |
| Three-mile median household income | $53,216 | $80,544 |
| Submarket inventory units | 5,001 | 31,741 |
| Submarket delivered units | 9 | 1,086 |

Crime, actual occupied units, and achieved-rent cells were confirmed empty when unsupported. Original formulas remained at their coordinates. Both files were marked draft and had zero filling errors.

The automated suites cover malformed and conflicting evidence, radius permutations and missing radii, split-page demographics, signed numbers, repeated table headers, missing, nonfinite, impossible, and incorrectly scaled scoring inputs, duplicate queued jobs, transactional rollback, concurrent revision changes, protected deletion and shared-source retention, fabricated model citations, corrupt/truncated checkpoints, workbook formula injection, changed/missing template structures, capacity overflow, and distinct floor plans with identical bed/bath labels.

Final checks passed: 25 Node tests, 24 Python tests, the production Webpack build, the development-server proxy smoke test, all local runtime checks, and the opt-in HTTP/workbook/model integration. `npm audit` reported zero vulnerabilities. Reproducible commands:

```sh
npm test
npm run build
npm audit
npm run local:doctor
# Backend must run against a separate data directory with the fixture PDFs extracted:
node scripts/verify-local.js
# Generate the two additional upload fixtures:
"$SERAFINA_PYTHON" scripts/create-adversarial-fixtures.py /tmp/serafina-adversarial-pdfs
# Real interruption test; the Python process reads this environment variable:
DOCLING_ARTIFACTS_PATH="$SERAFINA_DOCLING_ARTIFACTS_PATH" "$SERAFINA_PYTHON" scripts/verify-recovery.py
```

The shell commands using environment variables require those variables to be exported; Node entry points load `.env` themselves. Live integration checks intentionally create draft workbook files only in the selected data directory and do not run during the unit suite.

## Runtime and limitations

Ollama already had `qwen2.5:7b` installed on this machine. Actual inference, the loaded model, the Python environment, and the checksummed Docling artifacts were verified. No model download was needed. Processing and inference remain local. Server and development server bind to loopback; browser writes from unrelated origins are rejected.

The system can retain evidence from report layouts it does not yet understand. It cannot honestly guarantee that every possible CoStar version, damaged document, chart, OCR result, or future client question is perfectly interpreted. Unknown fields remain searchable/exportable; uncertain projections remain unavailable rather than becoming invented facts. Original PDFs remain the authoritative visual evidence.

The supplied reports lack six active scorecard inputs: renter-household percentage, violent crime, property crime, school ratings, walk score, and transit score. Their score readiness is therefore correctly insufficient. Reference snapshots can supply supported external facts. The underwriting template also contains assumptions beyond mapped CoStar inputs; every such assumption requires review, plus actual financial/rent-roll evidence and Excel recalculation before use as underwriting.

Deletion is guarded against active extraction and shared sources. As with the existing local filesystem architecture, a disk or permission failure after committed database cleanup can leave an orphaned artifact requiring cleanup; database and filesystem operations are not a distributed transaction. Existing archives/revisions are retained until their owning property is permanently deleted. There is no automated semantic certification, multi-user service, or unattended investment-decision approval.
