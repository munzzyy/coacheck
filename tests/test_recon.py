"""Tests for coacheck.recon: hand-verified reconstitution math."""

import unittest

from coacheck.recon import compute_recon


class HandVerifiedMath(unittest.TestCase):
    def test_basic_draw(self):
        # 5mg in 2mL water = 2500 mcg/mL. A 250mcg dose is 0.1mL = 10 units.
        r = compute_recon(5.0, 2.0, 250.0)
        self.assertAlmostEqual(r.concentration_mcg_per_ml, 2500.0, places=9)
        self.assertAlmostEqual(r.ml_per_dose, 0.1, places=9)
        self.assertAlmostEqual(r.units_per_dose, 10.0, places=9)
        self.assertAlmostEqual(r.doses_per_vial, 20.0, places=9)
        self.assertFalse(r.exceeds_vial)

    def test_full_vial_as_a_single_dose(self):
        # 1mg in 1mL = 1000 mcg/mL. A 1000mcg dose is the whole vial: 1.0mL = 100 units.
        r = compute_recon(1.0, 1.0, 1000.0)
        self.assertAlmostEqual(r.ml_per_dose, 1.0, places=9)
        self.assertAlmostEqual(r.units_per_dose, 100.0, places=9)
        self.assertAlmostEqual(r.doses_per_vial, 1.0, places=9)
        self.assertFalse(r.exceeds_vial)

    def test_ten_mg_vial_five_ml_water_hundred_mcg_dose(self):
        # 10mg in 5mL = 2000 mcg/mL. 100mcg dose = 0.05mL = 5 units; 100 doses/vial.
        r = compute_recon(10.0, 5.0, 100.0)
        self.assertAlmostEqual(r.concentration_mcg_per_ml, 2000.0, places=9)
        self.assertAlmostEqual(r.ml_per_dose, 0.05, places=9)
        self.assertAlmostEqual(r.units_per_dose, 5.0, places=9)
        self.assertAlmostEqual(r.doses_per_vial, 100.0, places=9)


class ExceedsVial(unittest.TestCase):
    def test_dose_larger_than_vial_flags_exceeds(self):
        # 1mg vial, dose asked for is 2000mcg = 2mg, twice the vial's content.
        r = compute_recon(1.0, 1.0, 2000.0)
        self.assertTrue(r.exceeds_vial)
        self.assertLess(r.doses_per_vial, 1.0)

    def test_dose_exactly_equal_to_vial_does_not_exceed(self):
        r = compute_recon(1.0, 1.0, 1000.0)
        self.assertFalse(r.exceeds_vial)


class InputValidation(unittest.TestCase):
    def test_zero_vial_raises(self):
        with self.assertRaises(ValueError):
            compute_recon(0.0, 2.0, 250.0)

    def test_zero_water_raises(self):
        with self.assertRaises(ValueError):
            compute_recon(5.0, 0.0, 250.0)

    def test_zero_dose_raises(self):
        with self.assertRaises(ValueError):
            compute_recon(5.0, 2.0, 0.0)

    def test_negative_vial_raises(self):
        with self.assertRaises(ValueError):
            compute_recon(-5.0, 2.0, 250.0)

    def test_negative_water_raises(self):
        with self.assertRaises(ValueError):
            compute_recon(5.0, -2.0, 250.0)

    def test_negative_dose_raises(self):
        with self.assertRaises(ValueError):
            compute_recon(5.0, 2.0, -250.0)

    def test_nan_vial_raises(self):
        with self.assertRaises(ValueError):
            compute_recon(float("nan"), 2.0, 250.0)

    def test_inf_water_raises(self):
        with self.assertRaises(ValueError):
            compute_recon(5.0, float("inf"), 250.0)

    def test_result_is_a_frozen_dataclass(self):
        r = compute_recon(5.0, 2.0, 250.0)
        with self.assertRaises(Exception):
            r.units_per_dose = 0.0


if __name__ == "__main__":
    unittest.main()
