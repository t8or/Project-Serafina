import unittest
from pathlib import Path

import pypdfium2 as pdfium

from src.services.processors.costar_page_selector import select_property_summary_end


PROJECT_ROOT = Path(__file__).resolve().parents[1]


CORE_SUMMARY = """
Subject Property
123 Main St - Example Apartments
Phoenix, Arizona - Example Neighborhood
PROPERTY MANAGER Example Management
PROPERTY - No. of Units: 183 Stories: 2 Avg. Unit Size: 863 SF Year Built: 1985
OWNER Example Owner
Purchased Mar 2019
$27,450,000 ($150,000/Unit)
ASKING RENTS PER UNIT/SF
VACANCY
12 MONTH ABSORPTION
UNIT BREAKDOWN
Unit Mix Availability Avg Asking Rent Avg Effective Rent
1 1 750 10 50.0% 1 10.0% $1,250 $1.67 $1,225 $1.63
Totals 750 10 100% 1 10.0% $1,250 $1.67 $1,225 $1.63
SITE AMENITIES
"""

FINAL_DETAILS = """
Subject Property
UNIT AMENITIES
RECURRING EXPENSES
ONE TIME EXPENSES
PET POLICY
"""


def first_page_texts(pdf_path: Path, page_limit: int = 10) -> list[str]:
    pdf = pdfium.PdfDocument(str(pdf_path))
    texts = []
    try:
        for page_index in range(min(len(pdf), page_limit)):
            page = pdf[page_index]
            text_page = page.get_textpage()
            texts.append(text_page.get_text_bounded())
            text_page.close()
            page.close()
    finally:
        pdf.close()
    return texts


class CoStarPageSelectorTest(unittest.TestCase):
    def test_real_reports_end_subject_property_coverage_on_page_five(self):
        for file_name in ("Serafina CoStart Report.pdf", "Hawks Landing CoStar.pdf"):
            with self.subTest(file_name=file_name):
                pages = first_page_texts(PROJECT_ROOT / file_name)
                self.assertEqual(select_property_summary_end(pages, ceiling=10), 5)

    def test_stops_when_documented_subject_property_coverage_is_complete(self):
        pages = [
            "Underwriting Report",
            "Table of contents: SUBJECT PROPERTY RENT COMPS",
            "Table of contents continued",
            CORE_SUMMARY,
            FINAL_DETAILS,
            "Subject Property Primary Building Building Building",
            "Subject Property Interior Interior Building",
            "Rent Comparables",
        ]

        self.assertEqual(select_property_summary_end(pages, ceiling=10), 5)

    def test_follows_required_details_when_a_new_layout_moves_them(self):
        pages = [
            "Underwriting Report",
            "Table of contents",
            "Subject Property introduction",
            CORE_SUMMARY,
            "Additional property facts",
            "More property facts",
            FINAL_DETAILS,
            "Rent Comparables",
        ]

        self.assertEqual(select_property_summary_end(pages, ceiling=10), 7)

    def test_waits_when_required_purchase_and_effective_rent_data_moves_later(self):
        partial_summary = CORE_SUMMARY.replace("Purchased Mar 2019\n", "").replace(
            "$27,450,000 ($150,000/Unit)\n", ""
        ).replace(" Avg Effective Rent", "")
        pages = [
            "Underwriting Report",
            "Table of contents",
            "Subject Property introduction",
            partial_summary,
            FINAL_DETAILS,
            "Property photos",
            "Purchased Mar 2019\n$27,450,000 ($150,000/Unit)\nAvg Effective Rent",
            "Rent Comparables",
        ]

        self.assertEqual(select_property_summary_end(pages, ceiling=10), 7)

    def test_does_not_count_core_labels_from_the_table_of_contents(self):
        partial_summary = CORE_SUMMARY.replace(" Avg Effective Rent", "")
        pages = [
            "Underwriting Report",
            "Table of contents: Avg Effective Rent",
            "Table of contents continued",
            partial_summary,
            FINAL_DETAILS,
            "Property photos",
            "Property photos",
            "Rent Comparables",
            "Rent comparable detail",
            "Rent comparable detail",
        ]

        self.assertEqual(select_property_summary_end(pages, ceiling=10), 10)

    def test_uses_safety_ceiling_when_required_coverage_is_not_detectable(self):
        pages = ["unrecognized content"] * 15

        self.assertEqual(select_property_summary_end(pages, ceiling=10), 10)


if __name__ == "__main__":
    unittest.main()
