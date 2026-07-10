"""Lightweight extraction of scorecard inputs from native CoStar PDF text."""

import re
from typing import Any, Iterable


NUMBER = r"[\d,]+(?:\.\d+)?"


def _number(value: str) -> float:
    return float(value.replace(",", "").replace("$", "").replace("%", ""))


def _integer(value: str) -> int:
    cleaned = value.replace(",", "").strip()
    return 0 if cleaned in {"-", "—"} else int(cleaned)


def _three_mile_value(text: str, label_pattern: str, value_pattern: str = NUMBER):
    match = re.search(
        rf"(?mi)^\s*{label_pattern}\s+({value_pattern})\s+({value_pattern})\s+({value_pattern})\s*$",
        text,
    )
    return match.group(2) if match else None


def _extract_demographics(text: str) -> dict[str, float | int]:
    if "DEMOGRAPHIC SUMMARY" not in text.upper():
        return {}

    population = _three_mile_value(text, r"\d{4}\s+Population")
    growth = _three_mile_value(
        text,
        r"Pop\s+Growth\s+\d{4}\s*-\s*\d{4}",
        rf"{NUMBER}%",
    )
    income = _three_mile_value(text, r"Median\s+Household\s+Income", rf"\${NUMBER}")
    home_value = _three_mile_value(text, r"Median\s+Home\s+Value", rf"\${NUMBER}")

    metrics: dict[str, float | int] = {}
    if population is not None:
        metrics["population_3mile"] = _integer(population)
    if growth is not None:
        metrics["population_growth_3mile"] = _number(growth) / 100
    if income is not None:
        metrics["median_hh_income_3mile"] = _integer(income.replace("$", ""))
    if home_value is not None:
        metrics["median_home_value_3mile"] = _integer(home_value.replace("$", ""))
    return metrics


def _extract_submarket(text: str) -> dict[str, float]:
    upper = text.upper()
    if "KEY INDICATORS" not in upper or "12 MO DELIVERED UNITS" not in upper:
        return {}

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    delivered_units = None
    total_units = None
    vacancy_rate = None
    construction_units = None

    for index, line in enumerate(lines):
        if line.upper().startswith("12 MO DELIVERED UNITS") and index > 0:
            summary_values = lines[index - 1].split()
            if len(summary_values) >= 3:
                delivered_units = _integer(summary_values[0])
                vacancy_rate = _number(summary_values[2]) / 100

        if line.upper().startswith("SUBMARKET ") and "%" in line and "$" in line:
            row_values = line.split()
            if len(row_values) >= 4:
                total_units = _integer(row_values[1])
                vacancy_rate = _number(row_values[2]) / 100
                construction_units = _integer(row_values[-1])

    metrics: dict[str, float] = {}
    if vacancy_rate is not None:
        metrics["vacancy_rate"] = vacancy_rate
    if total_units:
        if delivered_units is not None:
            metrics["delivered_pct_of_inventory"] = delivered_units / total_units
        if construction_units is not None:
            metrics["construction_pct_of_inventory"] = construction_units / total_units
    return metrics


def extract_scoring_metrics(page_texts: Iterable[str]) -> dict[str, Any]:
    """Extract only scorecard fields and their 1-based source pages."""
    result: dict[str, Any] = {
        "demographics": {},
        "submarket": {},
        "demographics_page": None,
        "submarket_page": None,
    }

    for page_number, text in enumerate(page_texts, start=1):
        if not result["demographics"]:
            demographics = _extract_demographics(text)
            if demographics:
                result["demographics"] = demographics
                result["demographics_page"] = page_number

        if not result["submarket"]:
            submarket = _extract_submarket(text)
            if submarket:
                result["submarket"] = submarket
                result["submarket_page"] = page_number

        if result["demographics"] and result["submarket"]:
            break

    return result
