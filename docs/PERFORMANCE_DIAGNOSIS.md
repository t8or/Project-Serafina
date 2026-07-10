# PDF extraction performance diagnosis

Date: 2026-07-09

## Observed run

The 14.2 MB, 127-page `Hawks Landing CoStar.pdf` run took approximately 824
seconds from upload to final extracted output. A repeatable one-page probe of
the production processor took 9.3-9.6 seconds, used about 1 GB maximum resident
memory, and reported a 4.7 GB peak memory footprint. Docling selected Apple's
MPS accelerator.

## Root cause

The processor converted every page, including large rent-comparable,
construction, sales, demographics, submarket, and market appendices. The
bounded job still initializes OCR, layout, and table models for each subprocess;
that fixed cost is much smaller than processing the additional 117 pages.

## Field audit

For the observed CoStar report:

- Pages 1-3 are primarily the table of contents.
- Page 4 contains the mapped property, ownership, management, unit-mix, rent,
  and vacancy data.
- Page 5 adds amenities, fees, and pet policy.
- Pages 6-8 contain secondary property detail and provenance.
- Page 9 begins rent-comparable appendices.

The workbook mapping consumes property/owner/manager fields and the subject
unit-mix table. Its demographic cells are explicitly external inputs. Normal
extraction is therefore capped at 10 pages, while local reference data remains
the intended source for demographic and submarket enrichment.

## Verified improvement

Running the original 127-page source through the bounded processor produced:

| Profile | Wall time | Processed pages | Required mapped fields |
| --- | ---: | ---: | --- |
| Original full report | ~824 seconds | 127 | Present, but comparable rows polluted subject data |
| Portable safety default | ~32 seconds | 10 | Present |
| Validated CoStar profile | 14.6 seconds | 4 | Present |

The four-page result retained units, average unit size, stories, year built,
manager, owner, purchase price/date, and all eight subject unit-mix rows. The
runtime keeps a 10-page safety ceiling and automatically selects four when a
native-text preflight recognizes the complete CoStar property summary on page
4. Unrecognized and scanned layouts use the safety ceiling.

The four-page run also logged a non-blocking warning while exporting a table
with duplicate column names; the required property and unit-mix tables were
still present. That table-normalization issue is separate from the performance
fix and should be addressed before relying on generic `otherTables` output.

## Follow-up opportunities

- Default to four or five pages for a report profile once multiple sample
  formats confirm that their required fields appear that early.
- Skip OCR for digitally generated PDFs after a native-text preflight.
- Use TableFormer's fast mode or invoke table reconstruction only on detected
  property-table pages after validating field-level accuracy.
- Keep a warm Docling worker to amortize model initialization across uploads.
- Add phase-level timing and processed-page counts to the extraction response.
