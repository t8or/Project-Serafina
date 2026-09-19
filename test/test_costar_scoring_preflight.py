import unittest
from pathlib import Path

import pypdfium2 as pdfium

from src.services.processors.costar_scoring_preflight import extract_scoring_metrics


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def native_page_texts(pdf_path: Path) -> list[str]:
    pdf = pdfium.PdfDocument(str(pdf_path))
    texts = []
    try:
        for page_index in range(len(pdf)):
            page = pdf[page_index]
            text_page = page.get_textpage()
            try:
                texts.append(text_page.get_text_bounded())
            finally:
                text_page.close()
                page.close()
    finally:
        pdf.close()
    return texts


class CoStarScoringPreflightTest(unittest.TestCase):
    def test_does_not_invent_metrics_from_an_unlabeled_layout(self):
        metrics = extract_scoring_metrics([
            """
Overview
Example Multi-Family
- 0 8.0% 0.0%
12 Mo Delivered Units 12 Mo Absorption Units Vacancy Rate 12 Mo Asking Rent Growth
KEY INDICATORS
Submarket 1,000 8.0% $1,000 $990 0 0 -
"""
        ])

        self.assertEqual(metrics["submarket"], {})

    def test_extracts_hawks_scoring_metrics_from_two_target_pages(self):
        metrics = extract_scoring_metrics(
            native_page_texts(PROJECT_ROOT / "Hawks Landing CoStar.pdf")
        )

        self.assertEqual(
            metrics["demographics"],
            {
                "population_3mile": 41_435,
                "population_growth_3mile": 0.024,
                "median_hh_income_3mile": 53_216,
                "median_home_value_3mile": 191_157,
            },
        )
        self.assertEqual(metrics["demographics_page"], 79)
        self.assertEqual(metrics["submarket"]["vacancy_rate"], 0.079)
        self.assertAlmostEqual(metrics["submarket"]["delivered_pct_of_inventory"], 9 / 5_001)
        self.assertAlmostEqual(metrics["submarket"]["construction_pct_of_inventory"], 153 / 5_001)
        self.assertEqual(metrics["submarket_page"], 83)

    def test_extracts_serafina_scoring_metrics_from_two_target_pages(self):
        metrics = extract_scoring_metrics(
            native_page_texts(PROJECT_ROOT / "Serafina CoStart Report.pdf")
        )

        self.assertEqual(
            metrics["demographics"],
            {
                "population_3mile": 100_969,
                "population_growth_3mile": 0.075,
                "median_hh_income_3mile": 80_544,
                "median_home_value_3mile": 386_764,
            },
        )
        self.assertEqual(metrics["demographics_page"], 96)
        self.assertEqual(metrics["submarket"]["vacancy_rate"], 0.086)
        self.assertAlmostEqual(metrics["submarket"]["delivered_pct_of_inventory"], 1_086 / 31_741)
        self.assertAlmostEqual(metrics["submarket"]["construction_pct_of_inventory"], 507 / 31_741)
        self.assertEqual(metrics["submarket_page"], 100)


if __name__ == "__main__":
    unittest.main()
