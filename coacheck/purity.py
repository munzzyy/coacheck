"""Purity math: labeled mass vs. real deliverable peptide mass.

A vial's label states a mass (e.g. "5mg"). Two independent COA figures
determine how much of that is actually the target peptide:

  - HPLC purity: what fraction of the peptide-related chromatographic peak
    is the correct sequence (vs. truncated/related impurities).
  - Net peptide content: what fraction of the lyophilized powder's total
    mass is peptide at all, as opposed to water, acetate/TFA counterion
    salts, or other bound mass left over from synthesis. Many vendor COAs
    omit this figure.

This module's convention - documented here because it is a judgment call,
not a standard everyone agrees on - is that both fractions apply together
when both are present:

    actual_mg = labeled_mg * (purity_pct / 100) * (net_content_pct / 100)

and falls back to purity alone when net content isn't stated:

    actual_mg = labeled_mg * (purity_pct / 100)

The second form is the common simplification vendors imply when they only
publish a purity figure; it overstates actual peptide mass to the extent
salt/water mass is present, which is exactly why an unstated net content is
useful context, not noise.

Inputs outside their physically possible range (e.g. purity or net content
above 100%) are not rejected here - they're computed through and reported
as-is, because catching "not physically possible" is the checklist's job
(see redflags.py), not this module's. Rejecting here would hide the bad
number instead of surfacing it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class PurityResult:
    labeled_mg: float
    purity_pct: float
    net_content_pct: Optional[float]
    actual_mg: float
    shortfall_mg: float
    shortfall_pct: float


def _require_finite_nonnegative(name: str, value: float) -> None:
    if not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    if value < 0:
        raise ValueError(f"{name} must be >= 0")


def compute_purity(
    labeled_mg: float,
    purity_pct: float,
    net_content_pct: Optional[float] = None,
) -> PurityResult:
    """Compute the real deliverable peptide mass implied by a COA's figures.

    Args:
        labeled_mg: mass printed on the vial label. Must be > 0.
        purity_pct: HPLC purity, as a percentage (e.g. 99.1 for 99.1%).
        net_content_pct: net peptide content, as a percentage, if the COA
            states one. None means "not stated" - the calculation falls
            back to purity alone (see module docstring).

    Returns:
        A PurityResult with the actual peptide mass and the shortfall
        against the labeled mass, in both mg and percent.

    Raises:
        ValueError: if labeled_mg, purity_pct, or net_content_pct is
            non-finite (NaN/inf) or negative, or if labeled_mg is 0.
    """
    _require_finite_nonnegative("labeled_mg", labeled_mg)
    if labeled_mg == 0:
        raise ValueError("labeled_mg must be > 0")
    _require_finite_nonnegative("purity_pct", purity_pct)
    if net_content_pct is not None:
        _require_finite_nonnegative("net_content_pct", net_content_pct)

    fraction = purity_pct / 100.0
    if net_content_pct is not None:
        fraction *= net_content_pct / 100.0

    actual_mg = labeled_mg * fraction
    shortfall_mg = labeled_mg - actual_mg
    shortfall_pct = (shortfall_mg / labeled_mg) * 100.0

    return PurityResult(
        labeled_mg=labeled_mg,
        purity_pct=purity_pct,
        net_content_pct=net_content_pct,
        actual_mg=actual_mg,
        shortfall_mg=shortfall_mg,
        shortfall_pct=shortfall_pct,
    )
