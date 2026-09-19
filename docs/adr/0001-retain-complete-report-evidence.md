# Retain complete Report evidence before deriving outputs

Status: Accepted under the September 18 autonomous robustness request.

The earlier ten-page document ceiling kept ML cost low but discarded report appendices and future-use data. Native scoring enrichment also replaced retained sections. This contradicts the requested whole-report reuse.

Capture native text for every page, retain original PDFs, and process layout/OCR/table structure in bounded, resumable batches across the entire Report. Persist lossless Docling representations and ordered table cells, including duplicate headings. Unknown sections remain evidence. Coverage describes processing, not semantic correctness; charts and image-only evidence still require source inspection.

Keep local processing and SQLite. Each extraction publishes a coherent revision; models interpret retrieved evidence and cannot execute code, change files, or publish scores. Retained quotations make model answers inspectable but do not certify their interpretation.

Tradeoff: full layout extraction costs substantially more time and disk than summary-only extraction. Checkpoints preserve completed work after interruption. This narrowly supersedes the historic instruction not to change docling_full_processor in ARCHITECTURE_DEEPENING.md.
