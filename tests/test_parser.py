"""Tests for coacheck.parser: field extraction from a COA text blob."""

import unittest

from coacheck.parser import MAX_COA_TEXT_CHARS, ParsedCoa, parse_coa
from tests._helpers import fixture_text


class CleanFixture(unittest.TestCase):
    def test_all_fields_extracted(self):
        coa = parse_coa(fixture_text("coa_clean.txt"))
        self.assertEqual(coa.product_name, "Research Compound RC-118")
        self.assertEqual(coa.batch_lot, "RC118-20260214-A")
        self.assertEqual(coa.mass_mg, 5.0)
        self.assertEqual(coa.purity_pct, 99.1)
        self.assertEqual(coa.net_content_pct, 91.5)
        self.assertEqual(coa.method, "RP-HPLC-MS")
        self.assertEqual(coa.test_date, "2026-02-14")
        self.assertEqual(coa.lab_name, "Meridian Analytical Labs")


class MissingFieldFixtures(unittest.TestCase):
    def test_missing_batch_fixture(self):
        coa = parse_coa(fixture_text("coa_missing_batch.txt"))
        self.assertIsNone(coa.batch_lot)
        self.assertEqual(coa.mass_mg, 10.0)
        self.assertEqual(coa.purity_pct, 98.7)
        self.assertIsNone(coa.net_content_pct)

    def test_missing_lab_fixture(self):
        coa = parse_coa(fixture_text("coa_missing_lab.txt"))
        self.assertIsNone(coa.lab_name)
        self.assertEqual(coa.batch_lot, "TA2201-0091")
        self.assertEqual(coa.mass_mg, 2.0)

    def test_no_method_fixture(self):
        coa = parse_coa(fixture_text("coa_no_method.txt"))
        self.assertIsNone(coa.method)
        self.assertEqual(coa.purity_pct, 99.0)
        # A "method" mention buried in unlabeled prose must not false-positive.
        self.assertNotIn("analytical", (coa.method or ""))

    def test_low_purity_fixture(self):
        coa = parse_coa(fixture_text("coa_low_purity.txt"))
        self.assertEqual(coa.purity_pct, 91.4)
        self.assertEqual(coa.net_content_pct, 84.0)

    def test_implausible_net_fixture(self):
        coa = parse_coa(fixture_text("coa_implausible_net.txt"))
        self.assertEqual(coa.net_content_pct, 104.0)
        self.assertEqual(coa.purity_pct, 99.4)

    def test_minimal_fixture_only_has_product_name(self):
        coa = parse_coa(fixture_text("coa_minimal.txt"))
        self.assertEqual(coa.product_name, "Research Compound RC-1")
        self.assertIsNone(coa.purity_pct)
        self.assertIsNone(coa.net_content_pct)
        self.assertIsNone(coa.mass_mg)
        self.assertIsNone(coa.batch_lot)
        self.assertIsNone(coa.test_date)
        self.assertIsNone(coa.method)
        self.assertIsNone(coa.lab_name)


class MessyLabelsFixture(unittest.TestCase):
    """Real vendor COAs word every field differently; this fixture uses the
    alternate wording ("Peptide Name", "Lot No", "Quantity", "Purity
    (HPLC)", "Peptide Content", "Testing Method", "Date Tested", "Test
    Lab") and dash separators instead of colons throughout."""

    def setUp(self):
        self.coa = parse_coa(fixture_text("coa_messy_labels.txt"))

    def test_product_name(self):
        self.assertEqual(self.coa.product_name, "Sample Peptide SP-200")

    def test_batch_lot_with_slash(self):
        self.assertEqual(self.coa.batch_lot, "SP200/2026-11")

    def test_mass(self):
        self.assertEqual(self.coa.mass_mg, 5.0)

    def test_purity_with_parenthetical_label(self):
        self.assertEqual(self.coa.purity_pct, 98.9)

    def test_net_content_alternate_label(self):
        self.assertEqual(self.coa.net_content_pct, 90.2)

    def test_method_alternate_label(self):
        self.assertEqual(self.coa.method, "reverse-phase HPLC")

    def test_date_alternate_label_and_raw_text_kept(self):
        # Dates are copied verbatim, never parsed into a date object.
        self.assertEqual(self.coa.test_date, "11 May 2026")

    def test_lab_alternate_label(self):
        self.assertEqual(self.coa.lab_name, "Harborview Analytical")


class LabelVariants(unittest.TestCase):
    """Individual label-wording checks, isolated from a full document."""

    def test_purity_bare_label(self):
        self.assertEqual(parse_coa("Purity: 97%\n").purity_pct, 97.0)

    def test_purity_hplc_prefixed_label(self):
        self.assertEqual(parse_coa("HPLC Purity: 97.5%\n").purity_pct, 97.5)

    def test_purity_parenthetical_hplc_label(self):
        self.assertEqual(parse_coa("Purity (HPLC): 96.2%\n").purity_pct, 96.2)

    def test_purity_percent_symbol_in_label_no_percent_on_value(self):
        # "Purity (%): 97.1" - the value itself has no trailing % sign.
        self.assertEqual(parse_coa("Purity (%): 97.1\n").purity_pct, 97.1)

    def test_purity_with_inequality_qualifier(self):
        self.assertEqual(parse_coa("Purity: >=98%\n").purity_pct, 98.0)

    def test_purity_with_unicode_qualifier(self):
        self.assertEqual(parse_coa("Purity: ≥99%\n").purity_pct, 99.0)

    def test_product_name_label_variant(self):
        self.assertEqual(parse_coa("Product: Foo-1\n").product_name, "Foo-1")

    def test_peptide_name_label_variant(self):
        self.assertEqual(parse_coa("Peptide Name: Foo-2\n").product_name, "Foo-2")

    def test_compound_name_label_variant(self):
        self.assertEqual(parse_coa("Compound Name: Foo-3\n").product_name, "Foo-3")

    def test_lot_number_label_variant(self):
        self.assertEqual(parse_coa("Lot Number: L-99\n").batch_lot, "L-99")

    def test_batch_no_label_variant(self):
        self.assertEqual(parse_coa("Batch No: B-12\n").batch_lot, "B-12")

    def test_case_insensitive_label(self):
        self.assertEqual(parse_coa("purity: 95%\n").purity_pct, 95.0)


class DecimalSeparatorVariants(unittest.TestCase):
    """COAs from outside the US/UK commonly write decimals with a comma
    ("98,99%") instead of a dot - both must parse to the identical float."""

    def test_purity_comma_decimal(self):
        self.assertEqual(parse_coa("Purity: 98,99%\n").purity_pct, 98.99)

    def test_net_content_comma_decimal(self):
        self.assertEqual(parse_coa("Net Content: 89,99%\n").net_content_pct, 89.99)

    def test_mass_comma_decimal(self):
        self.assertEqual(parse_coa("Net Weight: 5,5mg\n").mass_mg, 5.5)

    def test_dot_decimal_still_parses_normally(self):
        # Regression guard: comma support must not disturb the common case.
        self.assertEqual(parse_coa("Purity: 98.99%\n").purity_pct, 98.99)

    def test_mixed_dot_and_comma_decimals_in_same_document(self):
        # Dot-decimal mass alongside comma-decimal purity and net content -
        # each field parses independently, so mixed conventions in one
        # document (or a copy-pasted template) don't cross-contaminate.
        coa = parse_coa("Net Weight: 5mg\nPurity: 98,99%\nNet Content: 89,99%\n")
        self.assertEqual(coa.mass_mg, 5.0)
        self.assertEqual(coa.purity_pct, 98.99)
        self.assertEqual(coa.net_content_pct, 89.99)


class Robustness(unittest.TestCase):
    def test_empty_text_returns_all_none(self):
        coa = parse_coa("")
        self.assertEqual(coa, ParsedCoa())

    def test_whitespace_only_text_returns_all_none(self):
        coa = parse_coa("   \n\n\t  \n")
        self.assertEqual(coa, ParsedCoa())

    def test_first_match_wins_on_duplicate_labels(self):
        text = "Purity: 91%\nPurity: 99%\n"
        self.assertEqual(parse_coa(text).purity_pct, 91.0)

    def test_extra_whitespace_around_separator_tolerated(self):
        coa = parse_coa("Purity   :    98.5 %\n")
        self.assertEqual(coa.purity_pct, 98.5)

    def test_non_str_raises_typeerror(self):
        with self.assertRaises(TypeError):
            parse_coa(b"Purity: 99%\n")

    def test_oversized_text_raises_valueerror(self):
        huge = "x" * (MAX_COA_TEXT_CHARS + 1)
        with self.assertRaises(ValueError):
            parse_coa(huge)

    def test_text_at_max_size_is_accepted(self):
        text = "Purity: 99%\n" + ("x" * (MAX_COA_TEXT_CHARS - 12))
        parse_coa(text)  # must not raise

    def test_unrelated_line_containing_label_word_is_not_matched(self):
        # "method" appears mid-sentence, not as a line label - must stay unmatched.
        coa = parse_coa("Note: no analytical method is disclosed here.\n")
        self.assertIsNone(coa.method)

    def test_result_is_a_frozen_dataclass(self):
        coa = parse_coa("Purity: 99%\n")
        with self.assertRaises(Exception):
            coa.purity_pct = 50.0


if __name__ == "__main__":
    unittest.main()
