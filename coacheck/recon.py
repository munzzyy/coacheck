"""Reconstitution arithmetic: vial mass + diluent volume + a dose -> a draw.

Pure unit conversion. A U-100 insulin syringe is marked so that 100 "units"
on its barrel equal 1 mL - that ratio is a fixed property of the syringe,
not a dosing recommendation, exactly like liftmath's lb/kg conversion is a
fixed property of the pound. This module does not suggest a dose; it takes
whatever dose it's given and reports what that means for the draw.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# A U-100 syringe barrel is marked in 100 units per mL, by definition of "U-100".
U100_UNITS_PER_ML = 100.0

_MCG_PER_MG = 1000.0


@dataclass(frozen=True)
class ReconResult:
    vial_mg: float
    water_ml: float
    dose_mcg: float
    concentration_mcg_per_ml: float
    ml_per_dose: float
    units_per_dose: float
    doses_per_vial: float
    exceeds_vial: bool


def _require_finite_positive(name: str, value: float) -> None:
    if not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    if value <= 0:
        raise ValueError(f"{name} must be > 0")


def compute_recon(vial_mg: float, water_ml: float, dose_mcg: float) -> ReconResult:
    """Compute draw volume, syringe units, and doses per vial.

    Args:
        vial_mg: total peptide mass in the vial, in mg.
        water_ml: bacteriostatic water added, in mL.
        dose_mcg: the dose to draw, in mcg.

    Returns:
        A ReconResult. `exceeds_vial` is True when the requested dose is
        larger than the whole vial's mass - that's an arithmetic fact about
        the numbers given (doses_per_vial < 1), not a warning against
        anything; the caller decides what to do with it.

    Raises:
        ValueError: if any argument is non-finite, zero, or negative.
    """
    _require_finite_positive("vial_mg", vial_mg)
    _require_finite_positive("water_ml", water_ml)
    _require_finite_positive("dose_mcg", dose_mcg)

    vial_mcg = vial_mg * _MCG_PER_MG
    concentration_mcg_per_ml = vial_mcg / water_ml
    ml_per_dose = dose_mcg / concentration_mcg_per_ml
    units_per_dose = ml_per_dose * U100_UNITS_PER_ML
    doses_per_vial = vial_mcg / dose_mcg

    return ReconResult(
        vial_mg=vial_mg,
        water_ml=water_ml,
        dose_mcg=dose_mcg,
        concentration_mcg_per_ml=concentration_mcg_per_ml,
        ml_per_dose=ml_per_dose,
        units_per_dose=units_per_dose,
        doses_per_vial=doses_per_vial,
        exceeds_vial=dose_mcg > vial_mcg,
    )
