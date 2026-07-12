"""Tests for coacheck.redflags: the mechanical checklist."""

import unittest

from coacheck.parser import ParsedCoa
from coacheck.redflags import RESEARCH_GRADE_PURITY_THRESHOLD, Status, run_checklist

CLEAN = ParsedCoa(
    product_name="Research Compound RC-1",
    purity_pct=99.0,
    net_content_pct=91.0,
    mass_mg=5.0,
    batch_lot="RC1-001",
    test_date="2026-01-01",
    method="HPLC-MS",
    lab_name="Example Analytical Labs",
)


def _flags_by_id(coa):
    return {f.id: f for f in run_checklist(coa)}


class ChecklistShape(unittest.TestCase):
    def test_returns_seven_flags_with_stable_ids(self):
        flags = run_checklist(CLEAN)
        ids = [f.id for f in flags]
        self.assertEqual(
            ids,
            ["CC-PURITY", "CC-BATCH", "CC-LAB", "CC-METHOD", "CC-DATE",
             "CC-PURITY-METHOD", "CC-NET"],
        )

    def test_all_pass_on_fully_populated_clean_coa(self):
        flags = run_checklist(CLEAN)
        self.assertTrue(all(f.status == Status.PASS for f in flags), flags)


class PurityCheck(unittest.TestCase):
    def test_missing_purity_is_fail(self):
        coa = ParsedCoa(purity_pct=None)
        flag = _flags_by_id(coa)["CC-PURITY"]
        self.assertEqual(flag.status, Status.FAIL)

    def test_purity_over_100_is_fail(self):
        coa = ParsedCoa(purity_pct=101.0)
        flag = _flags_by_id(coa)["CC-PURITY"]
        self.assertEqual(flag.status, Status.FAIL)

    def test_purity_negative_is_fail(self):
        coa = ParsedCoa(purity_pct=-5.0)
        flag = _flags_by_id(coa)["CC-PURITY"]
        self.assertEqual(flag.status, Status.FAIL)

    def test_purity_below_threshold_is_warn(self):
        coa = ParsedCoa(purity_pct=RESEARCH_GRADE_PURITY_THRESHOLD - 0.1)
        flag = _flags_by_id(coa)["CC-PURITY"]
        self.assertEqual(flag.status, Status.WARN)

    def test_purity_at_threshold_is_pass(self):
        coa = ParsedCoa(purity_pct=RESEARCH_GRADE_PURITY_THRESHOLD)
        flag = _flags_by_id(coa)["CC-PURITY"]
        self.assertEqual(flag.status, Status.PASS)

    def test_purity_at_100_is_pass(self):
        coa = ParsedCoa(purity_pct=100.0)
        flag = _flags_by_id(coa)["CC-PURITY"]
        self.assertEqual(flag.status, Status.PASS)


class BatchCheck(unittest.TestCase):
    def test_missing_batch_is_warn(self):
        flag = _flags_by_id(ParsedCoa(batch_lot=None))["CC-BATCH"]
        self.assertEqual(flag.status, Status.WARN)

    def test_present_batch_is_pass(self):
        flag = _flags_by_id(ParsedCoa(batch_lot="X-1"))["CC-BATCH"]
        self.assertEqual(flag.status, Status.PASS)


class LabCheck(unittest.TestCase):
    def test_missing_lab_is_warn(self):
        flag = _flags_by_id(ParsedCoa(lab_name=None))["CC-LAB"]
        self.assertEqual(flag.status, Status.WARN)

    def test_placeholder_lab_value_is_warn(self):
        for placeholder in ("N/A", "In-house", "internal", "Undisclosed"):
            with self.subTest(placeholder=placeholder):
                flag = _flags_by_id(ParsedCoa(lab_name=placeholder))["CC-LAB"]
                self.assertEqual(flag.status, Status.WARN)

    def test_named_lab_is_pass(self):
        flag = _flags_by_id(ParsedCoa(lab_name="Example Labs Inc."))["CC-LAB"]
        self.assertEqual(flag.status, Status.PASS)


class MethodCheck(unittest.TestCase):
    def test_missing_method_is_warn(self):
        flag = _flags_by_id(ParsedCoa(method=None))["CC-METHOD"]
        self.assertEqual(flag.status, Status.WARN)

    def test_present_method_is_pass(self):
        flag = _flags_by_id(ParsedCoa(method="HPLC"))["CC-METHOD"]
        self.assertEqual(flag.status, Status.PASS)


class DateCheck(unittest.TestCase):
    def test_missing_date_is_warn(self):
        flag = _flags_by_id(ParsedCoa(test_date=None))["CC-DATE"]
        self.assertEqual(flag.status, Status.WARN)

    def test_present_date_is_pass(self):
        flag = _flags_by_id(ParsedCoa(test_date="2026-01-01"))["CC-DATE"]
        self.assertEqual(flag.status, Status.PASS)


class PurityBackedByMethodCheck(unittest.TestCase):
    def test_purity_without_method_is_warn(self):
        coa = ParsedCoa(purity_pct=99.0, method=None)
        flag = _flags_by_id(coa)["CC-PURITY-METHOD"]
        self.assertEqual(flag.status, Status.WARN)

    def test_purity_with_method_is_pass(self):
        coa = ParsedCoa(purity_pct=99.0, method="HPLC")
        flag = _flags_by_id(coa)["CC-PURITY-METHOD"]
        self.assertEqual(flag.status, Status.PASS)

    def test_no_purity_claim_makes_this_check_pass_not_applicable(self):
        # CC-PURITY already fails for a missing purity value; this check
        # shouldn't pile on a second warning about the same missing field.
        coa = ParsedCoa(purity_pct=None, method=None)
        flag = _flags_by_id(coa)["CC-PURITY-METHOD"]
        self.assertEqual(flag.status, Status.PASS)


class NetContentCheck(unittest.TestCase):
    def test_missing_net_content_is_pass(self):
        flag = _flags_by_id(ParsedCoa(net_content_pct=None))["CC-NET"]
        self.assertEqual(flag.status, Status.PASS)

    def test_net_content_over_100_is_fail(self):
        flag = _flags_by_id(ParsedCoa(net_content_pct=104.0))["CC-NET"]
        self.assertEqual(flag.status, Status.FAIL)

    def test_net_content_zero_is_fail(self):
        flag = _flags_by_id(ParsedCoa(net_content_pct=0.0))["CC-NET"]
        self.assertEqual(flag.status, Status.FAIL)

    def test_net_content_negative_is_fail(self):
        flag = _flags_by_id(ParsedCoa(net_content_pct=-1.0))["CC-NET"]
        self.assertEqual(flag.status, Status.FAIL)

    def test_net_content_at_100_is_pass(self):
        flag = _flags_by_id(ParsedCoa(net_content_pct=100.0))["CC-NET"]
        self.assertEqual(flag.status, Status.PASS)

    def test_net_content_plausible_value_is_pass(self):
        flag = _flags_by_id(ParsedCoa(net_content_pct=88.5))["CC-NET"]
        self.assertEqual(flag.status, Status.PASS)


if __name__ == "__main__":
    unittest.main()
