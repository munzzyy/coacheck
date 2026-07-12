"""Tests for coacheck.purity: hand-verified purity math."""

import unittest

from coacheck.purity import compute_purity


class HandVerifiedMath(unittest.TestCase):
    def test_purity_only_no_net_content(self):
        # 5mg labeled, 98% purity, no net content stated.
        # actual = 5 * 0.98 = 4.9; shortfall = 0.1mg = 2.0%
        r = compute_purity(5.0, 98.0)
        self.assertAlmostEqual(r.actual_mg, 4.9, places=9)
        self.assertAlmostEqual(r.shortfall_mg, 0.1, places=9)
        self.assertAlmostEqual(r.shortfall_pct, 2.0, places=9)
        self.assertIsNone(r.net_content_pct)

    def test_purity_and_net_content_combine_multiplicatively(self):
        # 5mg labeled, 99% purity, 92% net content.
        # fraction = 0.99 * 0.92 = 0.9108
        # actual = 5 * 0.9108 = 4.554; shortfall = 0.446mg = 8.92%
        r = compute_purity(5.0, 99.0, 92.0)
        self.assertAlmostEqual(r.actual_mg, 4.554, places=9)
        self.assertAlmostEqual(r.shortfall_mg, 0.446, places=9)
        self.assertAlmostEqual(r.shortfall_pct, 8.92, places=9)

    def test_100_percent_purity_no_net_content_is_no_shortfall(self):
        r = compute_purity(10.0, 100.0)
        self.assertAlmostEqual(r.actual_mg, 10.0, places=9)
        self.assertAlmostEqual(r.shortfall_mg, 0.0, places=9)
        self.assertAlmostEqual(r.shortfall_pct, 0.0, places=9)

    def test_zero_purity_is_total_shortfall(self):
        r = compute_purity(10.0, 0.0)
        self.assertAlmostEqual(r.actual_mg, 0.0, places=9)
        self.assertAlmostEqual(r.shortfall_mg, 10.0, places=9)
        self.assertAlmostEqual(r.shortfall_pct, 100.0, places=9)

    def test_100_percent_purity_and_net_content(self):
        # 2mg labeled, 100% purity, 80% net content -> actual = 1.6mg
        r = compute_purity(2.0, 100.0, 80.0)
        self.assertAlmostEqual(r.actual_mg, 1.6, places=9)
        self.assertAlmostEqual(r.shortfall_pct, 20.0, places=9)


class PermissiveOnImplausibleValues(unittest.TestCase):
    """The math module computes through implausible values rather than
    rejecting them - the checklist (redflags.py) is what flags them."""

    def test_purity_over_100_computes_actual_above_labeled(self):
        # 5mg labeled, 150% purity (impossible, but computed through).
        r = compute_purity(5.0, 150.0)
        self.assertAlmostEqual(r.actual_mg, 7.5, places=9)
        self.assertAlmostEqual(r.shortfall_mg, -2.5, places=9)
        self.assertAlmostEqual(r.shortfall_pct, -50.0, places=9)

    def test_net_content_over_100_computes_actual_above_labeled(self):
        # 5mg labeled, 99% purity, 110% net content (impossible).
        # fraction = 0.99 * 1.10 = 1.089; actual = 5.445mg
        r = compute_purity(5.0, 99.0, 110.0)
        self.assertAlmostEqual(r.actual_mg, 5.445, places=9)
        self.assertTrue(r.actual_mg > r.labeled_mg)


class InputValidation(unittest.TestCase):
    def test_zero_labeled_mg_raises(self):
        with self.assertRaises(ValueError):
            compute_purity(0.0, 98.0)

    def test_negative_labeled_mg_raises(self):
        with self.assertRaises(ValueError):
            compute_purity(-5.0, 98.0)

    def test_negative_purity_raises(self):
        with self.assertRaises(ValueError):
            compute_purity(5.0, -1.0)

    def test_negative_net_content_raises(self):
        with self.assertRaises(ValueError):
            compute_purity(5.0, 98.0, -1.0)

    def test_nan_labeled_mg_raises(self):
        with self.assertRaises(ValueError):
            compute_purity(float("nan"), 98.0)

    def test_inf_purity_raises(self):
        with self.assertRaises(ValueError):
            compute_purity(5.0, float("inf"))

    def test_nan_net_content_raises(self):
        with self.assertRaises(ValueError):
            compute_purity(5.0, 98.0, float("nan"))

    def test_result_is_a_frozen_dataclass(self):
        r = compute_purity(5.0, 98.0)
        with self.assertRaises(Exception):
            r.actual_mg = 0.0


if __name__ == "__main__":
    unittest.main()
