# Checks reference

What each red-flag check looks for, and the purity/reconstitution formulas behind the math.
This is informational tooling: nothing here endorses, recommends, or facilitates sourcing any
compound, and nothing here is medical advice.

## Purity math

```
fraction = purity_pct / 100
if net_content_pct is present:
    fraction *= net_content_pct / 100
actual_mg = labeled_mg * fraction
shortfall_mg = labeled_mg - actual_mg
shortfall_pct = shortfall_mg / labeled_mg * 100
```

Purity and net peptide content are two different figures. HPLC purity is what fraction of the
peptide-related chromatography peak is the correct sequence. Net peptide content is what
fraction of the vial's total powder mass is peptide at all, as opposed to water or counterion
salt left from synthesis. When a COA states both, this tool multiplies them together. When only
purity is stated - the common case - it uses purity alone, which is the simplification most
vendor-published numbers imply, and which overstates actual peptide mass by however much
salt/water is actually in the vial. That gap is exactly why an unstated net content matters.

Values outside the physically possible 0-100% range are computed through rather than rejected;
CC-PURITY and CC-NET (below) are what flag them.

## Reconstitution math

```
concentration_mcg_per_ml = (vial_mg * 1000) / water_ml
ml_per_dose = dose_mcg / concentration_mcg_per_ml
units_per_dose = ml_per_dose * 100   # U-100 syringe: 100 units = 1 mL, by definition
doses_per_vial = (vial_mg * 1000) / dose_mcg
```

The 100-units-per-mL ratio is a fixed property of a U-100 insulin syringe, not a recommendation.
This tool does not suggest a dose - `--dose` is whatever number you give it.

## Red-flag checks

### CC-PURITY

Whether a usable HPLC purity figure is present. FAIL if no purity percentage is found anywhere,
or if the stated value is outside the physically possible 0-100% range. WARN if purity is
present but below `RESEARCH_GRADE_PURITY_THRESHOLD` (98%, `coacheck/redflags.py`) - a labeling
convention some vendors use for "research grade" material, not a clinical or safety threshold.
PASS at or above that line.

### CC-BATCH

WARN if no batch or lot number is found. A result that isn't tied to a specific production run
can't be traced back to anything.

### CC-LAB

WARN if no testing laboratory is named, or if the field holds a placeholder value ("N/A",
"in-house", "undisclosed", etc.) rather than an actual name.

### CC-METHOD

WARN if no analytical method (e.g. HPLC, HPLC-MS) is named anywhere in the document.

### CC-DATE

WARN if no test date is found. Dates are copied verbatim from the document and never parsed or
validated - this only checks presence.

### CC-PURITY-METHOD

WARN if a purity percentage is stated but no method backs it up. PASS (not applicable) when
there's no purity claim at all - CC-PURITY already covers that case, so this check doesn't
double up on the same missing field.

### CC-NET

Only fires on the net peptide content figure, and only when one is present (it's an optional
field on most COAs; absence is not itself a flag). FAIL if the stated value is outside the
physically possible 0-100% range. PASS otherwise, including when the field is absent.

## What a clean checklist means

Seven PASS results mean nothing checked here is missing or physically impossible. It is not a
verdict on whether the document is genuine - a fabricated COA can fill in every field with
invented numbers, and a clean pass from this tool alone should never be read as confirmation
that a document is real. Likewise, a flagged document is not proof of anything - some legitimate
labs run brief reports that skip a field this checklist expects.
