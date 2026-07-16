// Purity math: labeled mass vs. real deliverable peptide mass.
//
// JS port of coacheck/purity.py - see that file for the full rationale on why purity and
// net content combine multiplicatively rather than the caller picking one. Field names stay
// snake_case to match the Python dataclass's JSON shape exactly; see parser.js for why.
//
// A vial's label states a mass (e.g. "5mg"). Two independent COA figures determine how much
// of that is actually the target peptide:
//
//   - HPLC purity: what fraction of the peptide-related chromatographic peak is the correct
//     sequence (vs. truncated/related impurities).
//   - Net peptide content: what fraction of the lyophilized powder's total mass is peptide
//     at all, as opposed to water, acetate/TFA counterion salts, or other bound mass left
//     over from synthesis. Many vendor COAs omit this figure.
//
// Convention (documented here because it's a judgment call, not a standard everyone agrees
// on): both fractions apply together when both are present -
//
//     actualMg = labeledMg * (purityPct / 100) * (netContentPct / 100)
//
// and falls back to purity alone when net content isn't stated:
//
//     actualMg = labeledMg * (purityPct / 100)
//
// Inputs outside their physically possible range (e.g. purity or net content above 100%)
// are not rejected here - they're computed through and reported as-is, because catching
// "not physically possible" is the checklist's job (see redflags.js), not this module's.

function requireFiniteNonNegative(name, value) {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`);
  }
  if (value < 0) {
    throw new RangeError(`${name} must be >= 0`);
  }
}

/**
 * Compute the real deliverable peptide mass implied by a COA's figures.
 *
 * @param {number} labeledMg - mass printed on the vial label. Must be > 0.
 * @param {number} purityPct - HPLC purity, as a percentage (e.g. 99.1 for 99.1%).
 * @param {?number} [netContentPct=null] - net peptide content, as a percentage, if the COA
 *   states one. null means "not stated" - the calculation falls back to purity alone.
 * @returns {{labeled_mg: number, purity_pct: number, net_content_pct: ?number,
 *   actual_mg: number, shortfall_mg: number, shortfall_pct: number}}
 * @throws {RangeError} if labeledMg, purityPct, or netContentPct is non-finite (NaN/inf) or
 *   negative, or if labeledMg is 0.
 */
export function computePurity(labeledMg, purityPct, netContentPct = null) {
  requireFiniteNonNegative("labeled_mg", labeledMg);
  if (labeledMg === 0) {
    throw new RangeError("labeled_mg must be > 0");
  }
  requireFiniteNonNegative("purity_pct", purityPct);
  if (netContentPct !== null) {
    requireFiniteNonNegative("net_content_pct", netContentPct);
  }

  let fraction = purityPct / 100.0;
  if (netContentPct !== null) {
    fraction *= netContentPct / 100.0;
  }

  const actualMg = labeledMg * fraction;
  const shortfallMg = labeledMg - actualMg;
  const shortfallPct = (shortfallMg / labeledMg) * 100.0;

  return {
    labeled_mg: labeledMg,
    purity_pct: purityPct,
    net_content_pct: netContentPct,
    actual_mg: actualMg,
    shortfall_mg: shortfallMg,
    shortfall_pct: shortfallPct,
  };
}
