# Adversarial review: Jev extraction architecture

Date: September 18, 2026.

Verdict: **The first draft had useful components but was not sufficient for dependable production use.** Keep Jev's bounded judgments, evidence references, targeted repair, and shared accepted revisions. Change the design so document coverage, source interpretation, output readiness, and recovery determine success. Model agreement alone is insufficient.

The [architecture plan](JEV_EXTRACTION_ARCHITECTURE.md) has been revised accordingly. This review changed documentation only. No property data was uploaded, live model evaluation performed, or production code changed.

## 1. Highest-priority findings

### P1 — The pipeline can verify every candidate and still omit required facts

The original plan centered review on values that parsers emit. A field silently missed by the parser would receive no candidate review. Required-field coverage must be created before candidate extraction and retained even for absent output.

**Reproduced in the current code with synthetic text:**

| Input challenge | Current result | Required result |
| --- | --- | --- |
| A demographics page has population; a later demographics page adds income | Population returned, income omitted | Merge compatible evidence per field; continue searching for outstanding fields |
| Header order is 3-mile / 1-mile / 5-mile and values are 300 / 100 / 500 | `population_3mile = 100` | Select 300 by the header or abstain on unsupported layout |
| Population growth values are negative | Empty demographic result | Parse the signed values and preserve the requested radius/period |

Evidence: [`costar_scoring_preflight.py`](../src/services/processors/costar_scoring_preflight.py), lines 7–35 and 97–111. `_three_mile_value` assumes the second value is three-mile data, the number pattern excludes signs, and a first nonempty demographic result stops further demographic extraction.

These are exercised adversarial inputs, not claims that the checked-in PDFs currently contain those layouts. They show the limits of the current implementation and why adding a reviewer does not establish coverage.

**Change:** add a required-field coverage ledger, header-aware deterministic parsing, candidate collection across relevant pages, and separate reasons for unreadable evidence, failed search, and true absence within a supported source scope. The ten-page ML budget cannot certify document completeness.

### P1 — Missing evidence becomes a negative property decision

**Reproduced:** `new ScoringService().calculateScore({})` returns score `0`, decision `Rejected`, with all 13 factors missing.

Evidence: [`scoring_service.js`](../src/services/scoring_service.js), lines 306–312 and 355–400.

If Jev flags a value and the system withholds it, the original plan could feed additional nulls into the same calculation. Better extraction review could therefore change a property decision for the wrong reason.

**Change:** an eligibility wrapper blocks business-decision publication when required factors are unresolved. Show `Insufficient data`. Preserve established formulas and weights for complete inputs; do not invent a new partial-score method. This is a mandatory integration change, not an optional UI disclaimer.

### P1 — A fresh Jev call is not an independent verifier

Scenario: OCR reads `8.2%` as `3.2%`. The local model copies `3.2%`; Jev confirms it appears in the supplied text. Both agree and both are wrong relative to the page. A second Jev call can repeat the same failure.

This is an architectural counterexample, not a live Jev result. TypeSafe documents that adversarial source content can influence answers and that confidence is derived from the answer distribution. [Limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13), [confidence](https://docs.typesafe.ai/confidence).

**Change:** for material/conflicted fields, obtain a source-first candidate without exposing the proposed value. When reading fidelity is uncertain, inspect a different representation or original page. Preserve disagreement instead of averaging votes. Model variety helps only when it introduces useful evidence or failure diversity; it is not a correctness proof.

### P1 — A valid fact snapshot does not guarantee a valid workbook

The first draft emphasized shared accepted data but under-specified the final artifact. Wrong mappings, template changes, skipped cells, row shifts, or stale formula results can corrupt an otherwise correct extraction.

**Code inspection:** [`xlsx_template_filler.py`](../src/services/processors/xlsx_template_filler.py), lines 115–161, initializes `status: success`, appends an error for a missing mapped sheet, saves the workbook, and returns the fill report. This low-level path can report success with errors; it was not exercised as an end-to-end export during this review.

**Change:** explicitly distinguish file creation from artifact readiness. Reopen and validate actual cells, sheets, row alignment, required mappings, and formulas. A missing required sheet blocks publication. Calculated workbook outputs require verified recalculation or an explicit pending-calculation state. Draft labels travel inside the file.

### P1 — The draft's pilot quality threshold was inadequate

The proposed 95% accepted-repair precision was not a suitable release basis. As an illustration only, if 20 fields independently had 95% correctness, all 20 would be correct only about 36% of the time. Actual errors are correlated, so this calculation is not an estimate of Serafina performance; it explains why per-field averages do not certify whole reports.

**Change:** remove that threshold. Measure report-level correctness/completeness, false acceptance, omissions, harmful corrections, automation coverage, and human effort. A 100–200 field pilot finds problems; it does not establish rare-error reliability. Production numerical tolerances are still to be set. Unattended material publication remains disabled until evidence meets those tolerances.

## 2. Additional design weaknesses

| Severity | Failure | Required correction |
| --- | --- | --- |
| P1 | Current-period and historical values collapse into one field; a correct old source wins | Fact identity includes entity, period, scope and row; distinguish report date, metric date and import time; retain competing claims |
| P1 | Human correction from an old report persists into a new one | Bind confirmation to evidence and period, mark stale when inputs change |
| P1 | Async jobs assume `db.connect()` creates transaction isolation | Current adapter shares one connection. Serialize synchronous transaction callbacks; do not await network/process work inside transactions |
| P1 | Crash between file write and DB publication leaves false readiness | Stage → validate → rename → ready manifest, with orphan reconciliation and manifest-controlled downloads |
| P1 | Model-generated strings can become formulas in a spreadsheet | Enforce typed mapping and literal-string storage for extracted text; models cannot add formulas, links, cell paths, or file paths |
| P2 | Resource caps quietly abandon a recoverable extraction | Caps end one attempt; persist an actionable next step and resume using changed evidence/method |
| P2 | Two bed/bath-identical rows merge despite different floor plans | Stable source table/row identities plus explicit aggregation policy |
| P2 | Zero, dash, blank and unavailable are conflated | Source-specific missing conventions; unknown does not become zero without evidence |
| P2 | Repeated model calls or a moving alias change accepted output | Full fingerprints, canary evaluation, explicit revision promotion, and audit of cached answers |
| P2 | All difficult cases go to humans, making quality look excellent | Publish automation coverage, time to resolution and review burden alongside accepted precision |

The concurrency finding is based on inspecting [`database.js`](../src/config/database.js), lines 60–84. It is a design risk for the proposed concurrent jobs, not a reproduced corruption incident.

## 3. Is a better solution available?

Yes: the architecture should be a staged evidence-processing system with models as replaceable decision components. Jev is valuable, but it should not be the mechanism that defines truth or completion.

Recommended order:

1. **Source inventory and coverage:** know the requested output, required facts, supported document family, and what was actually inspected.
2. **Deterministic extraction:** fix known parsing defects, retain headers and coordinates, collect all relevant candidates.
3. **Jev interpretation:** resolve candidate meaning, identify scope conflicts, rank evidence, and direct the next operation.
4. **Targeted local work:** generate only when selection and code cannot resolve the field. Reprocess source structure when the issue is OCR/table reading.
5. **Evidence-based validation:** compare source-first results where warranted, check invariants, and expose unresolved disagreement.
6. **Publication checks:** qualify each output separately and validate the produced file.
7. **Durable correction history:** resume interruptions and invalidate dependent outputs when accepted inputs change.

Keep one local application and durable job runner. This does not require multiple services or an elaborate autonomous-agent framework.

### Alternatives to compare before choosing the generation backend

| Option | Why it could win | Why it might lose |
| --- | --- | --- |
| Better deterministic parsing plus Jev candidate selection | Avoids generation, gives exact source values | Cannot interpret every layout or repair poor OCR |
| Existing small local model plus Jev-directed repair | Modest compute, focused prompts | Repeated weak-model repairs may be slower and less accurate |
| Stronger local model in one scoped extraction pass plus Jev checks | Could need fewer retries and better interpret tables | More memory and cold-start cost; hardware feasibility must be measured |
| Local layout/OCR reprocessing plus semantic review | Addresses bad source reading directly | Additional compute; cannot recover information absent from the PDF |

Do not assume the most complicated cascade wins. Use the simplest configuration that satisfies correctness and completion requirements on representative reports. A new hosted generative extractor is not necessary to this plan and would be a separate provider decision.

## 4. What “works every time” should mean operationally

For supported documents, the target is complete and correct results with minimal review. For the whole system, require:

- Every requested field has an explicit disposition; no silent omission.
- No artifact is labeled ready solely because parsing, a model call, or file saving succeeded.
- Missing required inputs never become a property rejection.
- Conflicts and unreadable sources have an actionable resolution path.
- Crashes, timeouts, duplicate jobs, cancellation and late responses cannot overwrite newer accepted work.
- Every published output identifies its source revision and mapping/configuration versions.
- Each human correction can be inspected, reversed, and invalidated when its source changes.

These behaviors are testable. Perfect unattended interpretation of arbitrary PDFs is not a credible guarantee. The architecture must expose remaining uncertainty while actively working to reduce it; a permanently blocked queue is not success.

## 5. Adversarial validation plan

Start by turning the reproduced probes into permanent regression fixtures when implementing fixes. Then test complete documents and actual output artifacts.

| Challenge family | Required assertion |
| --- | --- |
| Reordered radii, date columns, current/historical columns | Same semantic value or explicit unsupported-layout state; never positional guessing |
| Negative, parenthesized, locale-specific, rounded or missing numbers | Correct normalized value with raw source retained, or explicit unresolved state |
| First partial page followed by fuller evidence | Outstanding fields continue searching; conflicts remain visible |
| Duplicate/continued unit-mix tables | No dropped/duplicated rows; correct scope-aware totals |
| OCR digit mutation with plausible number | Source-reading discrepancy escalates; text agreement alone cannot certify it |
| Candidate replaced with an incorrect value | Verifier rejects or escalates; compare blind source-first result |
| Evidence removed or swapped with another property | Publication fails for unsupported identity/evidence |
| Missing sheet, changed template, wrong cell type or formula-like text | Actual workbook validation fails; source text remains literal |
| Jev outage or local-model invalid JSON | Baseline draft survives, verified publication does not occur |
| Crash at each revision/artifact transition | Restart converges to one valid result or a visible actionable state |
| Human edit while model is running | Old model result cannot overwrite the edit |
| Changed model, rubric, reference snapshot or source bytes | Affected cached decisions and derived outputs are invalidated |

Label expected answers from original pages. Have material ambiguities independently adjudicated. Keep report/layout families separated between development and holdout sets. Evaluate input perturbations such as irrelevant-page insertion and candidate-order changes; changes in output reveal fragility even if both runs look plausible.

Do not run production data through paid models merely to claim this review was exhaustive. The current review establishes deterministic counterexamples and design requirements; model-dependent claims still need the above evaluation.

## 6. Reproduction evidence

The review ran this read-only Python probe against the actual preflight module:

```python
from src.services.processors.costar_scoring_preflight import extract_scoring_metrics

cases = {
    "partial_first_page": [
        "DEMOGRAPHIC SUMMARY\nRadius 1 mile 3 miles 5 miles\n2026 Population 100 300 500",
        "DEMOGRAPHIC SUMMARY\nRadius 1 mile 3 miles 5 miles\n2026 Population 100 300 500\nMedian Household Income $10,000 $30,000 $50,000",
    ],
    "reordered_radii": [
        "DEMOGRAPHIC SUMMARY\nRadius 3 miles 1 mile 5 miles\n2026 Population 300 100 500",
    ],
    "negative_growth": [
        "DEMOGRAPHIC SUMMARY\nRadius 1 mile 3 miles 5 miles\nPop Growth 2020-2026 -1.0% -2.0% -3.0%",
    ],
}
for name, pages in cases.items():
    print(name, extract_scoring_metrics(pages)["demographics"])
```

Observed:

```text
partial_first_page {'population_3mile': 300}
reordered_radii {'population_3mile': 100}
negative_growth {}
```

Node probe, run with `node --input-type=module`:

```javascript
import { ScoringService } from './src/services/scoring_service.js';
const result = new ScoringService().calculateScore({});
console.log({
  score: result.score,
  decision: result.decision,
  missingFactors: Object.values(result.breakdown)
    .filter(factor => factor.rawValue === null).length,
});
// Observed: { score: 0, decision: 'Rejected', missingFactors: 13 }
```

## 7. Decision

Do not implement the first draft unchanged. Implement coverage, deterministic correctness, eligibility and artifact publication first. Add Jev review as an observable layer, then benchmark local correction alternatives. Expand automation only after evaluating complete outputs and recovery behavior.

The worthwhile part of the original solution survives: Jev can reduce unnecessary generation and direct useful corrections. The revision makes those model judgments subordinate to explicit source, completeness, and publication requirements.
