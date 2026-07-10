import unittest

from src.services.processors.docling_transformer import DoclingTransformer


class DoclingTransformerPageFiveTest(unittest.TestCase):
    def setUp(self):
        self.transformer = DoclingTransformer()

    def test_extracts_plain_text_unit_amenities_and_one_time_expenses(self):
        raw_text = """
UNIT AMENITIES
Air Conditioning
Balcony
Washer/Dryer Hookup
ONE TIME EXPENSES
Admin Fee $200
Application Fee $50
PET POLICY
Dog Allowed Cat Allowed
"""

        amenities = self.transformer._extract_all_amenities([], raw_text, [])
        expenses = self.transformer._extract_one_time_expenses([], raw_text)

        self.assertEqual(
            amenities["unit"],
            ["Air Conditioning", "Balcony", "Washer/Dryer Hookup"],
        )
        self.assertEqual(expenses, {"admin_fee": 200.0, "application_fee": 50.0})

    def test_extracts_plain_text_recurring_expenses(self):
        raw_text = """
RECURRING EXPENSES
Free Water, Heat, Trash
ONE TIME EXPENSES
Application Fee $40
PET POLICY
Cat Allowed
"""

        expenses = self.transformer._extract_recurring_expenses([], raw_text)

        self.assertEqual(expenses["utilities_included"], ["Water", "Heat", "Trash"])
        self.assertEqual(expenses["description"], "Free Water, Heat, Trash")

    def test_extracts_supported_heading_aliases(self):
        raw_text = """
APARTMENT AMENITIES
Dishwasher
ONE TIME FEES
Deposit $500
PET POLICIES
Dog Allowed
"""

        amenities = self.transformer._extract_all_amenities([], raw_text, [])
        expenses = self.transformer._extract_one_time_expenses([], raw_text)

        self.assertEqual(amenities["unit"], ["Dishwasher"])
        self.assertEqual(expenses, {"deposit": 500.0})


if __name__ == "__main__":
    unittest.main()
