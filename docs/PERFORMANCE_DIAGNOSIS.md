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

The first optimization used page 4 as a fixed recognized-report cutoff. That
was incomplete: both checked-in reports put the final subject-property details
on page 5, and every uploaded report must be treated as a new layout rather than
matched to a known report identity.

## Field audit

For the observed CoStar report:

- Pages 1-3 are primarily the table of contents.
- Page 4 contains the mapped property, ownership, management, unit-mix, rent,
  and vacancy data.
- Page 5 adds unit amenities, expenses/fees, and pet policy used by the
  extraction schema.
- Later pages contain property photos and the rent-comparable and market
  appendices; they are not inputs to the subject-property extraction.

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
| Content-complete subject profile | 14.35 seconds | 5 | Present, including page-5 details |

The current selector performs a native-text pass over no more than 10 pages and
accumulates the complete documented auto-fill field set. It requires property
identity/location, management, ownership and purchase history, asking and
effective rents, vacancy/absorption, a value-bearing completed unit-mix table,
and the final amenity, one-time-expense, and pet-policy groups. Both
`Serafina CoStart Report.pdf` and
`Hawks Landing CoStar.pdf` select page 5. A regression fixture with those final
details moved later selects page 7. Unrecognized and scanned layouts use the
10-page safety ceiling rather than processing the full report.

The native-text preflight for both checked-in reports completes in about 0.05
seconds combined. The end-to-end Hawks validation retained all five selected
pages from the 127-page source and took 14.35 seconds. Its maximum resident set
was about 1.14 GB; macOS reported a 4.89 GB peak memory footprint while the
Docling models used the MPS accelerator.

## Validation notes

- The first post-change command-line replay failed before PDF processing
  because the selector import resolved only in package mode. The processor now
  supports both package import and the app's direct-script launch; both paths
  are covered by the final validation.
- The five-page run logged a non-blocking warning while exporting a table with
  duplicate column names. The required property and unit-mix tables were still
  present. That normalization issue is separate from the performance fix and
  should be addressed before relying on generic `otherTables` output.
- The web build succeeds on Node 26.5.0 with non-blocking warnings for stale
  Browserslist data and Node's deprecated `module.register()` API in a build
  dependency.

## Follow-up opportunities

- Skip OCR for digitally generated PDFs after a native-text preflight.
- Use TableFormer's fast mode or invoke table reconstruction only on detected
  property-table pages after validating field-level accuracy.
- Keep a warm Docling worker to amortize model initialization across uploads.
- Add phase-level timing and processed-page counts to the extraction response.
