"""Content-completeness selector for the CoStar subject-property section."""

import re
from typing import Iterable, Sequence


UNIT_AMENITY_HEADINGS = ("UNIT AMENITIES", "APARTMENT AMENITIES")
RECURRING_EXPENSE_HEADINGS = ("RECURRING EXPENSES", "RECURRING FEES")
ONE_TIME_EXPENSE_HEADINGS = ("ONE TIME EXPENSES", "ONE TIME FEES")
PET_POLICY_HEADINGS = ("PET POLICY", "PET POLICIES")
UNIT_COUNT_HEADINGS = ("NO OF UNITS", "NUMBER OF UNITS")

CORE_FIELD_GROUPS = (
    UNIT_COUNT_HEADINGS,
    ("STORIES", "FLOORS"),
    ("AVG UNIT SIZE", "AVERAGE UNIT SIZE"),
    ("YEAR BUILT",),
    ("PROPERTY MANAGER",),
    ("OWNER",),
    ("PURCHASED", "PURCHASE DATE", "ACQUIRED"),
    ("ASKING RENTS", "ASKING RENT"),
    ("AVG EFFECTIVE RENT", "AVERAGE EFFECTIVE RENT", "EFFECTIVE RENT"),
    ("VACANCY",),
    ("12 MONTH ABSORPTION", "12 MO ABSORPTION"),
    ("UNIT BREAKDOWN", "UNIT MIX"),
    ("TOTALS",),
    ("SITE AMENITIES", "COMMUNITY AMENITIES"),
)

FINAL_DETAIL_GROUPS = (
    UNIT_AMENITY_HEADINGS,
    ONE_TIME_EXPENSE_HEADINGS,
    PET_POLICY_HEADINGS,
)

STREET_AND_NAME_PATTERN = re.compile(
    r"(?m)^\s*\d{1,6}\s+[^\r\n]{2,}\s+-\s+[^\r\n]{2,}\s*$",
    re.IGNORECASE,
)
CITY_AND_STATE_PATTERN = re.compile(
    r"(?m)^\s*[A-Z][A-Z .'-]+,\s*[A-Z][A-Z .'-]+(?:\s+-\s+[^\r\n]+)?\s*$",
    re.IGNORECASE,
)
PURCHASE_PRICE_PATTERN = re.compile(
    r"(?:PURCHASE\s+PRICE\s*:?\s*\$[\d,]+|\$[\d,]+\s*\(\$?[\d,]+\s*/\s*UNIT\))",
    re.IGNORECASE,
)
UNIT_MIX_ROW_PATTERN = re.compile(
    r"(?m)^\s*(?:STUDIO|\d+\s*(?:BR)?\s+\d+(?:\.\d+)?)"
    r"[^\r\n]*\d+(?:\.\d+)?%[^\r\n]*\$[\d,]+",
    re.IGNORECASE,
)
UNIT_COUNT_VALUE_PATTERN = re.compile(
    r"(?:NO\.?\s*OF\s*UNITS|NUMBER\s*OF\s*UNITS)\s*:?\s*[\d,]+",
    re.IGNORECASE,
)


def _normalize(text: str) -> str:
    return re.sub(r"[^A-Z0-9]+", " ", text.upper()).strip()


def _matched_groups(text: str, groups: Sequence[Sequence[str]]) -> set[int]:
    normalized = _normalize(text)
    return {
        index
        for index, alternatives in enumerate(groups)
        if any(_normalize(marker) in normalized for marker in alternatives)
    }


def _has_required_values(text: str) -> bool:
    """Confirm value-bearing rows for identity, purchase, and unit mix."""
    return all(
        pattern.search(text)
        for pattern in (
            STREET_AND_NAME_PATTERN,
            CITY_AND_STATE_PATTERN,
            PURCHASE_PRICE_PATTERN,
            UNIT_COUNT_VALUE_PATTERN,
            UNIT_MIX_ROW_PATTERN,
        )
    )


def select_property_summary_end(page_texts: Iterable[str], ceiling: int = 10) -> int:
    """Return the last page needed to cover the documented property fields.

    Every documented auto-fill group and value-bearing identity, purchase, and
    unit-mix signal must be present. Completeness headings are considered only
    after the value-bearing subject summary begins, which prevents
    table-of-contents labels from causing an early stop. If native text cannot
    prove completeness, the bounded ceiling is returned instead of processing
    the full report.
    """
    if not isinstance(ceiling, int) or ceiling < 4 or ceiling > 10:
        raise ValueError(f"ceiling must be an integer from 4 to 10; received {ceiling}")

    pages = list(page_texts)[:ceiling]
    if not pages:
        return ceiling

    core_matches: set[int] = set()
    detail_matches: set[int] = set()
    observed_texts: list[str] = []
    subject_summary_started = False

    for page_number, text in enumerate(pages, start=1):
        observed_texts.append(text)
        observed_text = "\n".join(observed_texts)

        subject_summary_started = subject_summary_started or (
            UNIT_COUNT_VALUE_PATTERN.search(text) is not None
            and STREET_AND_NAME_PATTERN.search(observed_text) is not None
            and CITY_AND_STATE_PATTERN.search(observed_text) is not None
        )

        if subject_summary_started:
            core_matches.update(_matched_groups(text, CORE_FIELD_GROUPS))
            detail_matches.update(_matched_groups(text, FINAL_DETAIL_GROUPS))

        if (
            len(core_matches) == len(CORE_FIELD_GROUPS)
            and len(detail_matches) == len(FINAL_DETAIL_GROUPS)
            and _has_required_values(observed_text)
        ):
            return page_number

    return min(len(pages), ceiling) if len(pages) < ceiling else ceiling
