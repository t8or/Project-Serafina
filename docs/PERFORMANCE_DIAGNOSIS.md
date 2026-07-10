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

The next five-page implementation preserved the property data but produced a
zero score with all 13 factors missing. The scorecard consumes demographic,
submarket, crime, school, and walk/transit inputs—not the property/unit fields.
Removing the later PDF sections without replacing their score inputs was the
scoring regression.

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
unit-mix table. The scorecard additionally consumes demographic and submarket
values present later in the report. A native-text pass extracts those few
values directly; renter share and third-party metrics remain reference inputs.

## Verified improvement

Running the original 127-page source through the bounded processor produced:

| Profile | Wall time | ML-processed pages | Property and scoring data |
| --- | ---: | ---: | --- |
| Original full report | ~824 seconds | 127 | Present, but comparable rows polluted subject data |
| Portable safety default | ~32 seconds | 10 | Present |
| Property-only profile (regression) | 14.35 seconds | 5 | Property present; score inputs missing |
| Two-tier property + score profile | 15.17 seconds | 5 | Property present; 7 PDF score factors populated |

The current selector performs a native-text pass over no more than 10 pages and
accumulates the complete documented auto-fill field set. It requires property
identity/location, management, ownership and purchase history, asking and
effective rents, vacancy/absorption, a value-bearing completed unit-mix table,
and the final amenity, one-time-expense, and pet-policy groups. Both
`Serafina CoStart Report.pdf` and
`Hawks Landing CoStar.pdf` select page 5. A regression fixture with those final
details moved later selects page 7. Unrecognized and scanned layouts use the
10-page safety ceiling rather than processing the full report.

The full native-text scan of both checked-in reports (279 pages total) completes
in about 0.8 seconds combined. The end-to-end Hawks validation sent five pages
through Docling, sourced scoring values from pages 79 and 83, and took 15.17
seconds. It produced a 4.52 score with 7 populated PDF factors and 6 genuinely
unavailable factors, compared with the regressed 0 score and 13 missing factors.
Its maximum resident set was about 1.09 GB while Docling used MPS.

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
