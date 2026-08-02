"""Tests for coacheck.parser: field extraction from a COA text blob."""

import time
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


class SeparatorRules(unittest.TestCase):
    """A dash only separates a label from its value when whitespace comes first.
    Compound label names carry their own hyphens, and reading the tail of the
    label as the value produced non-empty garbage that then passed the
    checklist ("Lot-Nr: RC118-A" used to yield a batch number of "Nr:")."""

    def test_hyphen_inside_lot_label_is_not_the_separator(self):
        self.assertEqual(parse_coa("Lot-Nr: RC118-A\n").batch_lot, "RC118-A")

    def test_hyphen_inside_batch_label_is_not_the_separator(self):
        self.assertEqual(parse_coa("Batch-No: RC118-A\n").batch_lot, "RC118-A")

    def test_hyphen_inside_lab_label_yields_no_lab(self):
        # "Lab-tested: yes" names no lab. It used to come back as "tested: yes",
        # which the checklist reported as PASS.
        self.assertIsNone(parse_coa("Lab-tested: yes\n").lab_name)

    def test_spaced_dash_separator_still_works(self):
        coa = parse_coa("Lot No - SP200/2026-11\nPurity (HPLC) - 98.9%\n")
        self.assertEqual(coa.batch_lot, "SP200/2026-11")
        self.assertEqual(coa.purity_pct, 98.9)

    def test_equals_separator(self):
        self.assertEqual(parse_coa("Purity = 99.1%\n").purity_pct, 99.1)

    def test_long_dash_separator(self):
        # OCR of a printed COA turns plenty of hyphens into an en or em dash.
        for dash in (chr(0x2013), chr(0x2014)):
            with self.subTest(dash=dash):
                self.assertEqual(parse_coa(f"Purity {dash} 99.1%\n").purity_pct, 99.1)


class TableLayout(unittest.TestCase):
    """Real COAs, and the OCR of one, are mostly two-column tables with the
    value aligned by whitespace and no punctuation at all. A gap of two or more
    spaces (or a tab) reads as a column boundary."""

    def test_whitespace_column_row_parses(self):
        coa = parse_coa(
            "Purity (HPLC)      99.1 %\n"
            "Batch/Lot          RC118-A\n"
            "Test Method        RP-HPLC\n"
            "Net Weight         5 mg\n"
        )
        self.assertEqual(coa.purity_pct, 99.1)
        self.assertEqual(coa.batch_lot, "RC118-A")
        self.assertEqual(coa.method, "RP-HPLC")
        self.assertEqual(coa.mass_mg, 5.0)

    def test_tab_column_row_parses(self):
        coa = parse_coa("Purity (HPLC)\t99.1 %\nNet Weight\t5 mg\n")
        self.assertEqual(coa.purity_pct, 99.1)
        self.assertEqual(coa.mass_mg, 5.0)

    def test_table_layout_fixture(self):
        coa = parse_coa(fixture_text("coa_table_layout.txt"))
        self.assertEqual(coa.product_name, "Table Layout Peptide TL-300")
        self.assertEqual(coa.batch_lot, "TL300-2026-04")
        self.assertEqual(coa.mass_mg, 5.0)
        self.assertEqual(coa.purity_pct, 99.1)
        self.assertEqual(coa.net_content_pct, 92.4)
        self.assertEqual(coa.method, "RP-HPLC")
        self.assertEqual(coa.test_date, "2026-04-02")
        self.assertEqual(coa.lab_name, "Northgate Analytical")

    def test_single_space_is_not_a_column_boundary(self):
        # "Sample Peptide SP-200" is one value, not three columns.
        self.assertEqual(
            parse_coa("Peptide Name - Sample Peptide SP-200\n").product_name,
            "Sample Peptide SP-200",
        )

    def test_prose_with_a_wide_gap_is_not_a_field(self):
        # The value side stays anchored, so a label word followed by words
        # rather than a number can't be read as a purity figure.
        self.assertIsNone(parse_coa("Purity  is  important\n").purity_pct)

    def test_padded_colon_is_still_one_field(self):
        # A gap that touches a separator is padding, not a column boundary.
        self.assertEqual(parse_coa("Purity   :    98.5 %\n").purity_pct, 98.5)


class TwoFieldsOnOneLine(unittest.TestCase):
    """A row rendered from a two-column table can hold two complete fields. The
    first used to swallow the second and report the whole run as its value."""

    def test_method_and_date_on_one_line(self):
        coa = parse_coa("Test Method: RP-HPLC    Test Date: 2026-02-14\n")
        self.assertEqual(coa.method, "RP-HPLC")
        self.assertEqual(coa.test_date, "2026-02-14")

    def test_batch_value_keeps_internal_spaces(self):
        # The old capture stopped at the first space and returned just "RC".
        self.assertEqual(parse_coa("Batch No.: RC 118 A\n").batch_lot, "RC 118 A")


class WordFormQualifiers(unittest.TestCase):
    """Pharma COAs write purity bounds as words ("NLT 98.0%") at least as often
    as symbols. Unmatched, they left purity None and CC-PURITY reported FAIL on
    a document that plainly states a purity."""

    def test_nlt_is_a_lower_bound(self):
        coa = parse_coa("Purity: NLT 98.0%\n")
        self.assertEqual(coa.purity_pct, 98.0)
        self.assertEqual(coa.purity_qualifier, ">=")

    def test_nmt_is_an_upper_bound(self):
        coa = parse_coa("Purity: NMT 98.0%\n")
        self.assertEqual(coa.purity_qualifier, "<=")

    def test_min_dot(self):
        self.assertEqual(parse_coa("Purity: min. 98.0%\n").purity_qualifier, ">=")

    def test_minimum_word(self):
        self.assertEqual(parse_coa("Purity: minimum 98.0%\n").purity_qualifier, ">=")

    def test_maximum_word(self):
        self.assertEqual(parse_coa("Purity: maximum 98.0%\n").purity_qualifier, "<=")

    def test_greater_than_words(self):
        self.assertEqual(parse_coa("Purity: greater than 99%\n").purity_qualifier, ">")

    def test_less_than_words(self):
        self.assertEqual(parse_coa("Purity: less than 99%\n").purity_qualifier, "<")

    def test_not_less_than_words(self):
        self.assertEqual(parse_coa("Purity: not less than 99%\n").purity_qualifier, ">=")

    def test_not_more_than_words(self):
        self.assertEqual(parse_coa("Purity: not more than 99%\n").purity_qualifier, "<=")

    def test_symbols_pass_through_unchanged(self):
        self.assertEqual(parse_coa("Purity: >=98%\n").purity_qualifier, ">=")


class MassUnits(unittest.TestCase):
    """Vials get labeled in mcg and g too. Everything normalizes to mg so the
    purity and reconstitution math downstream only ever sees one unit."""

    def test_mcg_normalizes_to_mg(self):
        self.assertEqual(parse_coa("Quantity: 5000 mcg\n").mass_mg, 5.0)

    def test_micro_sign_normalizes_to_mg(self):
        self.assertEqual(parse_coa("Net Weight: 5000 " + chr(0x00B5) + "g\n").mass_mg, 5.0)

    def test_greek_mu_normalizes_to_mg(self):
        self.assertEqual(parse_coa("Net Weight: 5000 " + chr(0x03BC) + "g\n").mass_mg, 5.0)

    def test_ug_normalizes_to_mg(self):
        self.assertEqual(parse_coa("Net Weight: 5000 ug\n").mass_mg, 5.0)

    def test_gram_normalizes_to_mg(self):
        self.assertEqual(parse_coa("Net Weight: 0.005 g\n").mass_mg, 5.0)

    def test_mg_is_unchanged(self):
        self.assertEqual(parse_coa("Net Weight: 5 mg\n").mass_mg, 5.0)

    def test_mg_per_vial_suffix_still_parses(self):
        self.assertEqual(parse_coa("Quantity: 5 mg/vial\n").mass_mg, 5.0)

    def test_unknown_unit_is_dropped_rather_than_guessed(self):
        # Better a missing field than a mass wrong by a factor of a thousand.
        self.assertIsNone(parse_coa("Net Weight: 5 kg\n").mass_mg)


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


class ThousandsSeparator(unittest.TestCase):
    """A comma grouping thousands ("1,000 mg") must not be read as a decimal
    comma, which used to silently divide a labeled mass by 1000."""

    def test_thousands_grouped_mass_is_not_divided(self):
        self.assertEqual(parse_coa("Quantity: 1,000 mg\n").mass_mg, 1000.0)

    def test_five_thousand_grouped_mass(self):
        self.assertEqual(parse_coa("Net Weight: 5,000 mg\n").mass_mg, 5000.0)

    def test_comma_decimal_still_reads_as_decimal(self):
        # Two digits after the comma is a decimal, not a thousands group.
        self.assertEqual(parse_coa("Purity: 98,99%\n").purity_pct, 98.99)


class PurityQualifier(unittest.TestCase):
    """A leading qualifier ("<98.5%") is captured, not silently dropped, so the
    checklist can tell an upper bound from a confirmed value."""

    def test_less_than_qualifier_captured(self):
        coa = parse_coa("Purity: <98.5%\n")
        self.assertEqual(coa.purity_pct, 98.5)
        self.assertEqual(coa.purity_qualifier, "<")

    def test_less_equal_qualifier_captured(self):
        coa = parse_coa("Purity: <=97%\n")
        self.assertEqual(coa.purity_qualifier, "<=")

    def test_greater_equal_qualifier_captured(self):
        self.assertEqual(parse_coa("Purity: >=98%\n").purity_qualifier, ">=")

    def test_no_qualifier_is_none(self):
        self.assertIsNone(parse_coa("Purity: 99%\n").purity_qualifier)

    def test_net_content_qualifier_captured(self):
        coa = parse_coa("Net Content: <90%\n")
        self.assertEqual(coa.net_content_pct, 90.0)
        self.assertEqual(coa.net_content_qualifier, "<")


class LineSeparatorVariants(unittest.TestCase):
    """str.splitlines() splits on more than \\n; the parser must find fields
    across all of them so it agrees with the JS port on the same bytes."""

    def _doc(self, sep):
        return f"Product Name: RC-118{sep}Purity: 92%{sep}Net Weight: 5 mg{sep}"

    def test_vertical_tab_separator(self):
        coa = parse_coa(self._doc("\x0b"))
        self.assertEqual(coa.product_name, "RC-118")
        self.assertEqual(coa.purity_pct, 92.0)

    def test_nel_separator(self):
        coa = parse_coa(self._doc("\x85"))
        self.assertEqual(coa.purity_pct, 92.0)

    def test_unicode_line_separator(self):
        coa = parse_coa(self._doc("\u2028"))
        self.assertEqual(coa.purity_pct, 92.0)


class AsciiDigitsOnly(unittest.TestCase):
    """Numeric matching is pinned to ASCII digits so a non-ASCII digit can't
    produce a value the JS port (whose \\d is ASCII) would miss."""

    def test_fullwidth_digits_not_parsed(self):
        self.assertIsNone(parse_coa("Purity: ９２．０%\n").purity_pct)


class NonFiniteToken(unittest.TestCase):
    """A digit run long enough to overflow float() to infinity is dropped, so
    it never reaches the checklist or JSON as a non-finite value."""

    def test_absurdly_long_number_is_dropped(self):
        coa = parse_coa("Purity: " + ("9" * 320) + "%\nNet Weight: 5 mg\n")
        self.assertIsNone(coa.purity_pct)
        self.assertEqual(coa.mass_mg, 5.0)


class ByteOrderMark(unittest.TestCase):
    """A leading UTF-8 BOM survives str.strip() and would otherwise stop the
    first line from matching a label."""

    def test_bom_prefixed_first_field_is_found(self):
        coa = parse_coa("\ufeffPurity: 99.5%\n")
        self.assertEqual(coa.purity_pct, 99.5)

    def test_bom_fixture_parses(self):
        coa = parse_coa(fixture_text("coa_bom.txt"))
        self.assertEqual(coa.product_name, "BOM Test BT-1")
        self.assertEqual(coa.purity_pct, 99.5)


class PathologicalWhitespace(unittest.TestCase):
    """The label patterns must not backtrack quadratically on a long run of
    whitespace after a label - the input cap is supposed to bound parse time."""

    def test_long_whitespace_run_parses_quickly(self):
        text = "purity" + (" " * (MAX_COA_TEXT_CHARS - 7)) + "x"
        start = time.perf_counter()
        parse_coa(text)
        elapsed = time.perf_counter() - start
        # ~0.004s after the fix; ~67s before it. The budget only fails on the
        # quadratic blowup, never on a slow-but-linear machine.
        self.assertLess(elapsed, 5.0)

    def test_long_whitespace_after_colon_parses_quickly(self):
        # The value side (after "purity:") is a separate pattern from the label
        # side above. A colon plus a long whitespace run then a non-digit used
        # to still backtrack quadratically because the qualifier group left two
        # adjacent \s* runs. Keep a colon-present case so that path stays bounded.
        text = "purity:" + (" " * (MAX_COA_TEXT_CHARS - 8)) + "x"
        start = time.perf_counter()
        parse_coa(text)
        elapsed = time.perf_counter() - start
        self.assertLess(elapsed, 5.0)

    def test_many_narrow_columns_parse_quickly(self):
        # Column splitting turns one line into several candidate strings, and
        # every one of them is run past every label pattern. MAX_LINE_SEGMENTS
        # is what stops a wall of two-space-separated tokens from multiplying
        # that work without bound.
        line = "a  " * 400
        text = "\n".join([line] * 80)
        start = time.perf_counter()
        parse_coa(text)
        elapsed = time.perf_counter() - start
        self.assertLess(elapsed, 5.0)


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
