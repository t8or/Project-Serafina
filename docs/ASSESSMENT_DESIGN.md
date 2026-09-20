# Assessment workflow redesign

## Design direction

The opening screen is a working assessment list. A user can add reports, find a property, inspect its scorecard and missing inputs, then move to the next property. Recommendations retain their existing meanings; opening an assessment does not mark it approved or reviewed.

Preserved: Serafina's blue accent and wordmark, system typography, existing routes and navigation labels, local processing, score calculations, deleted-property recovery, geographic filtering, keyboard focus handling, and appearance controls.

Reduced emphasis: large summary cards, always-visible charts, repeated headings and captions, row-level delete buttons, and settings. The sidebar is narrower, with Files and Scorecard settings at the bottom. Charts load only when Portfolio overview is opened.

## Journey

1. **New assessment** opens report selection.
2. Choose PDFs, then **Assess properties** starts processing directly. Progress and failed-file retry remain in the existing modal. A second start confirmation is no longer required.
3. Processing returns to the assessment list, ordered newest first.
4. Search by property or location, filter by recommendation or missing inputs, or sort by name or score.
5. **Review** opens the scorecard. A missing-input link opens the same view filtered to missing factors. **Next property** follows the current list order and filters.

On mobile, each table row becomes a compact property block containing its recommendation, score, missing inputs, and review action.

## Copy review

The supplied `clean-copy` skill is installed at `/Users/jish/.codex/skills/clean-copy/SKILL.md`, with its encoding repaired and its instructions preserved. The table below records original strings and their disposition; line numbers refer to the original revision for removed strings.

| Original location | Original string | Disposition | Reason |
| --- | --- | --- | --- |
| `src/dashboard.html:60` | Overview of analyzed properties and their scores | cut | Rung 2: repeats the title and visible list. |
| `src/partials/sidebar.html:26` | Property intelligence | cut | Rung 2: adds no context to the workspace. |
| `src/partials/sidebar.html:48` | Workspace | cut | Rung 2: unnecessary label for primary navigation. |
| `src/dashboard.html:500` | Click to filter | cut | Rung 2: direct filter buttons expose the action. |
| `src/dashboard.html:573` | Swipe horizontally to review every property field and action. | cut | Rung 4: mobile no longer requires horizontal table scrolling. |
| `src/file-upload.html:101` | Local PDF files only, up to 50 MB each. Each PDF is analyzed across all pages on this computer. | PDFs, up to 50 MB each. | Rungs 2–3: keep format and limit; remove implementation claims, including the outdated all-pages claim. |
| `src/file-upload.html:337` | Local PDF analysis | cut | Rung 2: redundant heading in the processing modal. |
| `src/file-upload.html:343` | Every PDF is processed by local Docling across all pages. Reference metrics are used only when a matching local snapshot has already been imported. | cut | Rungs 1–3: processing internals do not help the user operate this progress dialog. |

Retained consequences include deletion recovery terms and processing failures. After consolidation with the current scoring service, incomplete assessments display “Insufficient data” and have no final score. The review explains that missing inputs must be completed before a score can be assigned. The initial pre-consolidation preview used the older zero-point behavior; that behavior is superseded.

## Initial design validation (before consolidation)

- Production Webpack build passed.
- All 15 Node tests passed, including combined filters, sorting without mutating API results, null versus zero scores, empty results, duplicate-start prevention, and retry without duplicate uploads.
- Browser checked: property search, combined filter empty state and clearing, sorting, missing-only review, next property, Escape dismissal, deleted-list empty state and return, optional chart rendering, geographic route and return, and entry into report selection.
- Desktop and 390px mobile inspected in the browser; mobile review inspected in dark mode with no horizontal overflow. Temporary viewport and appearance changes were reset.
- Fixed an existing appearance-control error when no preference is saved, and removed duplicate dashboard initialization.
- Saved assessment API responses matched exactly before and after the work.

No new documents were processed and no property records were changed during validation. This change does not implement inline input correction, manual approval states, or a new extraction/review architecture.

## Consolidated report workflow

The assessment design now runs with the complete report, asynchronous extraction, stricter score eligibility, workbook, and hosting implementation on `main`. Report evidence uses the same shell and styles, with contextual property and file links, question answering and source quotations, evidence search, original PDFs, JSON/CSV exports, and processing details. See [consolidation validation](CONSOLIDATION.md) for the current runtime and checks.
