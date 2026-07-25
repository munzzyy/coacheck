"""Mechanical red-flag checklist for a parsed COA.

Every check below is a deterministic rule over the fields parser.py already
extracted - no inference about the document beyond "is this field present,
and is the number in it physically possible". Each check returns exactly one
Flag with a stable id, so a caller (or a test) can key off CC-PURITY the same
way whether the underlying wording of the report changes or not.

These are hygiene and plausibility checks, not a verdict. A clean checklist
means nothing obvious is missing or impossible; it is not a claim that the
document is genuine, and a flagged document is not proof it's fake - see the
README's "what this does not do" section.
"""

from __future__ import annotations

import enum
import math
import re
from dataclasses import dataclass

from .parser import ParsedCoa

# Purity line vendors commonly use for "research grade" material. This is a
# labeling convention this tool checks against, not a clinical or medical
# threshold, and not a claim that material below it is unsafe or fake.
# Change it here if you want to check against a different line.
RESEARCH_GRADE_PURITY_THRESHOLD = 98.0

# Purity qualifiers that make the stated number an upper bound rather than a
# confirmed value - "<98%" says purity is below 98, not that it is 98.
_UPPER_BOUND_QUALIFIERS = frozenset({"<", "<=", "≤"})

# Lab-name values that are present but don't actually name a lab. Matched
# against the normalized value (see _is_placeholder_lab), so "N.A.",
# "In-House Lab" and the like are caught too, not just the exact strings here.
_PLACEHOLDER_LAB_VALUES = frozenset(
    {"n/a", "na", "n.a.", "none", "in-house", "in house", "inhouse", "internal",
     "internal lab", "undisclosed", "confidential", "private", "tbd", "unknown",
     "not disclosed", "not specified", "not provided", "pending", "unavailable"}
)

# Generic trailing words a placeholder is often padded with ("In-House Lab",
# "Internal Laboratory"). Dropped before the placeholder check so the padding
# doesn't hide the placeholder underneath.
_GENERIC_LAB_WORDS = ("laboratories", "laboratory", "labs", "lab")


class Status(str, enum.Enum):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"


@dataclass(frozen=True)
class Flag:
    id: str
    status: Status
    title: str
    detail: str


def _normalize_lab(value: str) -> str:
    v = re.sub(r"\s+", " ", value.strip().lower())
    return v.strip(" .")


def _is_placeholder_lab(value: str) -> bool:
    v = _normalize_lab(value)
    if not v:
        return True
    # No letters or digits at all ("-", "--", ".").
    if not re.search(r"[a-z0-9]", v):
        return True
    # "n/a", "n.a.", "n a" all collapse to the same non-answer.
    if re.sub(r"[^a-z0-9]", "", v) == "na":
        return True
    if v in _PLACEHOLDER_LAB_VALUES:
        return True
    # "In-House Lab" -> "in-house"; a real name like "Private Analytics" keeps
    # its distinguishing word and is left alone.
    for word in _GENERIC_LAB_WORDS:
        if v.endswith(" " + word):
            if v[: -(len(word) + 1)].strip() in _PLACEHOLDER_LAB_VALUES:
                return True
            break
    return False


def _check_purity(coa: ParsedCoa) -> Flag:
    if coa.purity_pct is None:
        return Flag(
            "CC-PURITY", Status.FAIL,
            "No purity percentage found",
            "The document does not state an HPLC purity percentage anywhere. "
            "A COA without a purity figure can't be used to judge quality.",
        )
    if not math.isfinite(coa.purity_pct) or coa.purity_pct < 0 or coa.purity_pct > 100:
        return Flag(
            "CC-PURITY", Status.FAIL,
            "Stated purity is not physically possible",
            f"Purity is stated as {coa.purity_pct:g}%, which is outside the "
            "possible 0-100% range.",
        )
    if coa.purity_qualifier in _UPPER_BOUND_QUALIFIERS:
        return Flag(
            "CC-PURITY", Status.WARN,
            "Purity stated only as an upper bound",
            f"Stated purity is {coa.purity_qualifier}{coa.purity_pct:g}%, given "
            "only as an upper bound rather than a confirmed value, so it can't "
            f"be checked against the {RESEARCH_GRADE_PURITY_THRESHOLD:g}% "
            "research-grade line.",
        )
    if coa.purity_pct < RESEARCH_GRADE_PURITY_THRESHOLD:
        return Flag(
            "CC-PURITY", Status.WARN,
            "Purity below the research-grade reference line",
            f"Stated purity is {coa.purity_pct:g}%, below the "
            f"{RESEARCH_GRADE_PURITY_THRESHOLD:g}% line this tool checks "
            "research-grade material against.",
        )
    return Flag(
        "CC-PURITY", Status.PASS,
        "Purity at or above the research-grade line",
        f"Stated purity is {coa.purity_pct:g}%.",
    )


def _check_batch(coa: ParsedCoa) -> Flag:
    if not coa.batch_lot:
        return Flag(
            "CC-BATCH", Status.WARN,
            "No batch/lot number found",
            "The document doesn't reference a batch or lot number, so this "
            "result can't be tied to a specific production run.",
        )
    return Flag(
        "CC-BATCH", Status.PASS,
        "Batch/lot number present",
        f"Batch/lot: {coa.batch_lot}",
    )


def _check_lab(coa: ParsedCoa) -> Flag:
    if not coa.lab_name:
        return Flag(
            "CC-LAB", Status.WARN,
            "No testing laboratory named",
            "The document doesn't name the lab that ran the test.",
        )
    if _is_placeholder_lab(coa.lab_name):
        return Flag(
            "CC-LAB", Status.WARN,
            "Testing laboratory not actually named",
            f"The lab field holds a placeholder value ({coa.lab_name!r}) "
            "rather than a lab name.",
        )
    return Flag(
        "CC-LAB", Status.PASS,
        "Testing laboratory named",
        f"Lab: {coa.lab_name}",
    )


def _check_method(coa: ParsedCoa) -> Flag:
    if not coa.method:
        return Flag(
            "CC-METHOD", Status.WARN,
            "No test method found",
            "The document doesn't name the analytical method used (e.g. "
            "HPLC, HPLC-MS).",
        )
    return Flag(
        "CC-METHOD", Status.PASS,
        "Test method named",
        f"Method: {coa.method}",
    )


def _check_date(coa: ParsedCoa) -> Flag:
    if not coa.test_date:
        return Flag(
            "CC-DATE", Status.WARN,
            "No test date found",
            "The document doesn't state when the test was run.",
        )
    return Flag(
        "CC-DATE", Status.PASS,
        "Test date present",
        f"Test date: {coa.test_date}",
    )


def _check_purity_backed_by_method(coa: ParsedCoa) -> Flag:
    if coa.purity_pct is None:
        return Flag(
            "CC-PURITY-METHOD", Status.PASS,
            "No purity claim to check",
            "No purity percentage was found, so there's no claim here to "
            "check against a method (see CC-PURITY).",
        )
    if not coa.method:
        return Flag(
            "CC-PURITY-METHOD", Status.WARN,
            "Purity stated without a named test method",
            f"A purity of {coa.purity_pct:g}% is stated, but no analytical "
            "method backs it up anywhere in the document.",
        )
    return Flag(
        "CC-PURITY-METHOD", Status.PASS,
        "Purity is backed by a named method",
        f"Method: {coa.method}",
    )


def _check_net_content(coa: ParsedCoa) -> Flag:
    if coa.net_content_pct is None:
        return Flag(
            "CC-NET", Status.PASS,
            "No net peptide content stated",
            "Net peptide content is an optional field on most COAs; none "
            "was found in this document.",
        )
    value = coa.net_content_pct
    if not math.isfinite(value) or value <= 0 or value > 100:
        return Flag(
            "CC-NET", Status.FAIL,
            "Net peptide content is not physically plausible",
            f"Net peptide content is stated as {value:g}%, which is outside "
            "the physically possible 0-100% range.",
        )
    return Flag(
        "CC-NET", Status.PASS,
        "Net peptide content is within a plausible range",
        f"Net peptide content: {value:g}%",
    )


# Order here is the order flags are returned in, and the order they render in.
_CHECKS = (
    _check_purity,
    _check_batch,
    _check_lab,
    _check_method,
    _check_date,
    _check_purity_backed_by_method,
    _check_net_content,
)


def run_checklist(coa: ParsedCoa) -> list[Flag]:
    """Run every red-flag check against a parsed COA and return all 7 flags."""
    return [check(coa) for check in _CHECKS]
