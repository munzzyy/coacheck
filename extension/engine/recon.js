// Reconstitution arithmetic: vial mass + diluent volume + a dose -> a draw.
//
// JS port of coacheck/recon.py. Pure unit conversion - a U-100 insulin syringe is marked so
// that 100 "units" on its barrel equal 1 mL, a fixed property of the syringe, not a dosing
// recommendation. This module does not suggest a dose; it takes whatever dose it's given
// and reports what that means for the draw.

// A U-100 syringe barrel is marked in 100 units per mL, by definition of "U-100".
export const U100_UNITS_PER_ML = 100.0;

const MCG_PER_MG = 1000.0;

function requireFinitePositive(name, value) {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`);
  }
  if (value <= 0) {
    throw new RangeError(`${name} must be > 0`);
  }
}

/**
 * Compute draw volume, syringe units, and doses per vial.
 *
 * @param {number} vialMg - total peptide mass in the vial, in mg.
 * @param {number} waterMl - bacteriostatic water added, in mL.
 * @param {number} doseMcg - the dose to draw, in mcg.
 * @returns {{vial_mg: number, water_ml: number, dose_mcg: number,
 *   concentration_mcg_per_ml: number, ml_per_dose: number, units_per_dose: number,
 *   doses_per_vial: number, exceeds_vial: boolean}} exceeds_vial is true when the requested
 *   dose is larger than the whole vial's mass - an arithmetic fact about the numbers given
 *   (doses_per_vial < 1), not a warning against anything; the caller decides what to do
 *   with it.
 * @throws {RangeError} if any argument is non-finite, zero, or negative.
 */
export function computeRecon(vialMg, waterMl, doseMcg) {
  requireFinitePositive("vial_mg", vialMg);
  requireFinitePositive("water_ml", waterMl);
  requireFinitePositive("dose_mcg", doseMcg);

  const vialMcg = vialMg * MCG_PER_MG;
  const concentrationMcgPerMl = vialMcg / waterMl;
  const mlPerDose = doseMcg / concentrationMcgPerMl;
  const unitsPerDose = mlPerDose * U100_UNITS_PER_ML;
  const dosesPerVial = vialMcg / doseMcg;

  return {
    vial_mg: vialMg,
    water_ml: waterMl,
    dose_mcg: doseMcg,
    concentration_mcg_per_ml: concentrationMcgPerMl,
    ml_per_dose: mlPerDose,
    units_per_dose: unitsPerDose,
    doses_per_vial: dosesPerVial,
    exceeds_vial: doseMcg > vialMcg,
  };
}
