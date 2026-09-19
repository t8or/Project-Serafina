# Extraction and local model performance

Measured September 19, 2026, on an Apple M5 Pro with 24 GB unified memory, Docling 2.66.0, docling-core 2.57.0, MPS acceleration, and Ollama 0.34.2. These are local measurements on the bundled reports and deliberately ambiguous fixtures, not universal accuracy or performance guarantees.

## Separate extraction from questions

Native PDF text is read directly. EasyOCR reads image regions, Docling identifies layout, and TableFormer reconstructs tables. Ollama answers questions against the retained evidence **after** extraction. Replacing Qwen cannot accelerate these existing OCR or table stages.

All pages still receive structural processing, including pages with native text that might also contain embedded scans. TableFormer remains in accurate mode. Original PDFs, raw Docling documents, text, tables, and coordinates remain retained. No evidence was dropped to obtain these timings.

## Cold whole-report extraction

The controlled benchmark uses a fresh output directory, the same 127-page Hawks Landing PDF, and one process at a time. Times include Python imports and processing but exclude shell startup. Model downloads were active in the background; no Ollama inference competed for GPU memory. These are individual runs, so normal run-to-run variation remains.

| Configuration | Total | Pages | Tables | Comparison with baseline |
| --- | ---: | ---: | ---: | --- |
| EasyOCR, 8-page batches | 180.15 s | 127 | 170 | Baseline |
| EasyOCR, 32-page batches | 154.75 s | 127 | 170 | 14.1% faster; identical text, scoring facts, and table cells |
| Apple Vision, 32-page batches | 175.51 s | 127 | 170 | Slower than EasyOCR at the same batch size; identical text, scoring facts, and table cells |

The default is therefore 32-page batches with EasyOCR. Larger batches reduce repeated conversion overhead. This changes the maximum amount of work repeated after interruption from eight pages to 32; verified completed batches remain reusable. The supported range is 4–64 pages. The summary-page selector has a separate bounded ceiling and cannot accidentally truncate whole-report processing.

`SERAFINA_DOCLING_BATCH_PAGES` takes precedence over the historical `SERAFINA_MAX_PDF_PAGES` alias. `SERAFINA_OCR_ENGINE=ocrmac` enables Apple Vision explicitly on a Mac with the package installed; `auto` opts into platform selection. EasyOCR remains the default because it won this full-report comparison. Changing engine, versions, capture code, or pipeline options invalidates incompatible checkpoints without deleting prior report revisions.

### Timing interpretation

Reports now retain native-text inventory, conversion, checkpoint, and pipeline durations, plus fresh/cached page counts and batch timings. Job results additionally include application duration through the Python bridge, including startup and artifact verification. The report page displays processing time and checkpoint reuse.

Docling's `stage_work_seconds` measures cumulative work, with overlapping pipeline stages. **Do not add OCR, layout, and table times to estimate elapsed time.** Native text took about a tenth of a second in the production Hawks run; table reconstruction dominated structural processing. The old log-only runs did not record a separate OCR duration.

Production HTTP jobs with fresh checkpoints confirmed both complete reports:

| Report | Pages / tables | Application elapsed | Native text | OCR stage work | Table stage work |
| --- | ---: | ---: | ---: | ---: | ---: |
| Hawks Landing | 127 / 170 | 162.14 s | 0.10 s | 66.76 s | 143.24 s |
| Serafina | 152 / 207 | 206.61 s | 0.26 s | 73.07 s | 181.75 s |

Both matched the earlier retained revisions exactly for native text, scoring facts, and all 377 tables' headings/cells. The historical log-only conversion intervals were 175.54 s and 213.36 s respectively; those omitted startup and are not directly comparable to the application column above. New conversion-only times were 156.47 s and 200.48 s.

### Repeat extraction and checkpoint repair

The retry experiment uncovered a checksum defect in the earlier checkpoint writer: Python sorted integer page keys numerically before saving, but JSON reload converted keys to strings and sorted them lexicographically. A batch spanning pages 9–10 or 99–100 therefore failed validation even when its content was unchanged. The previous recovery test's first batch, pages 1–8, did not expose this.

The writer now hashes the exact JSON representation that is persisted. Regression checks cover both digit boundaries, actual disk round trips, Unicode text, and tampering after persistence. Modified or truncated caches remain rejected. The changed evidence-code fingerprint intentionally requires one fresh extraction; old report revisions remain available.

The final production validation ran both PDFs fresh, then repeated both unchanged:

| Report | Fresh extraction | Immediate repeat | Pages reused on repeat |
| --- | ---: | ---: | ---: |
| Hawks Landing | 158.46 s | 4.05 s | 127 / 127 |
| Serafina | 192.89 s | 3.21 s | 152 / 152 |

All times include Python startup and artifact verification. Both repeats performed zero fresh page conversions and preserved the same native text, OCR/layout text and text provenance, scoring facts, and table cells. Before the checksum repair, the measured Hawks retry took 86.00 s and unnecessarily recomputed 63 pages. Questions and exports already use saved evidence directly and do not require re-extraction.

## Model selection

Installed and measured the official Ollama [Qwen 3.5](https://ollama.com/library/qwen3.5) and [Gemma 4](https://ollama.com/library/gemma4) models, alongside the previous Qwen 2.5. All ran locally at temperature zero through the same application adapter, with 16K context. Thinking is disabled for the newer families to avoid unnecessary reasoning latency on evidence lookup. Incomplete/truncated generations are rejected.

| Model | Eight semantic checks passed | Median response |
| --- | ---: | ---: |
| Qwen 2.5 7B | 5/8 | 1.27 s |
| Qwen 3.5 9B | 7/8 | 1.71 s |
| Gemma 4 12B | 8/8 | 2.33 s |

**Gemma 4 12B is the new default.** It preserved parenthesized negative absorption, which both Qwen models reported as positive. Qwen 2.5 also subtracted availability from vacancy and unnecessarily abstained on the embedded-instruction case. Gemma's added latency is about one second at the median; its installed artifact is about 7.6 GB versus 4.7 GB for the old model. Existing overrides remain supported, and the old model remains installed for rollback.

Eight cases provide a useful regression check, not an accuracy certification. Exact quotation matching cannot establish that the model interpreted the quote correctly. Deterministic demographic lookups remain in place, generated answers remain drafts, and generated text never overwrites retained facts. See [all answers and inference timings](benchmarks/2026-09-19-models.json).

To compare or roll back locally, set `SERAFINA_OLLAMA_MODEL=qwen2.5:7b` (or `qwen3.5:9b`) and restart the server. Set `SERAFINA_DOCLING_BATCH_PAGES=8` to restore the smaller compute batches. Local `.env` settings and installed models are outside Git; switching branches alone does not change those overrides.

### OCR alternatives

On the two-page image-only fixture, EasyOCR plus Docling processing took 4.22 s (7.28 s including imports); Apple Vision took 2.76 s (4.77 s including imports). Apple Vision correctly retained `$83,210`, where EasyOCR read `583,210`. Neither recognized this unusual layout as a structured table. The original image remains essential evidence, and the scoring projection withholds unsupported values. This narrow result supports an explicit Apple Vision option, but not changing the whole-report default that measured slower with that engine.

As a separate experiment, both Qwen 3.5 and Gemma 4 correctly read the reordered 3-mile income and solar-capacity fields from the fixture's second-page image. Qwen took 12.42 s and Gemma 5.78 s, including cold model load. This experiment requests **two fields from one image**, not complete page transcription or table reconstruction. It is not comparable to the full Docling workload and is not wired into the fact store. The opt-in `scripts/benchmark-vision.js MODEL PAGE.png` harness preserves this distinction.

## Reproduce

Use the provisioned Python environment and set `DOCLING_ARTIFACTS_PATH` to the verified local model directory. Keep benchmarks separate from application output. Each cold benchmark refuses an existing output directory.

```sh
python scripts/benchmark-extraction.py 'Hawks Landing CoStar.pdf' /tmp/serafina-cold8 --batch-pages 8
python scripts/benchmark-extraction.py 'Hawks Landing CoStar.pdf' /tmp/serafina-cold32 --batch-pages 32
python scripts/compare-extraction.py /tmp/serafina-cold8 /tmp/serafina-cold32 --exact-tables --exact-layout
python scripts/benchmark-extraction.py 'Hawks Landing CoStar.pdf' /tmp/serafina-vision --batch-pages 32 --ocr-engine ocrmac
node scripts/benchmark-models.js qwen2.5:7b qwen3.5:9b gemma4:12b
```

The model harness calls the production constrained-answer adapter and quotation validator. It checks reordered and neighboring radii, historical/forecast periods, missing values, embedded instructions, vacancy versus availability, parenthesized negatives, and market versus submarket scope. These are gold-answer semantic checks, not assertions that a model merely returned JSON. Each model is unloaded before the next one. Download models beforehand and avoid competing GPU extraction jobs.

Machine-readable extraction measurements are in [the benchmark record](benchmarks/2026-09-19-extraction.json). The original [robustness audit](ROBUSTNESS_AUDIT.md) remains a historical record of the earlier configuration.

## Validation

The final run passed 26 Node tests and 27 Python tests, the production build, local runtime readiness, and live HTTP/question/workbook checks. The test wrapper was renamed to prevent Node's default discovery from running the wrapper itself and duplicating the Python suite. Browser verification confirmed the saved timing display. The performance branch preserves the original checkout and uses the existing isolated audit data directory on port 3011.
