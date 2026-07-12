"""Regex-based field extraction from a Certificate of Analysis (COA) text blob.

A COA is a lab report that comes with a peptide vial: a product name, an
HPLC purity percentage, sometimes a separate net peptide content percentage,
a mass/quantity, a batch or lot number, a test date, a test method, and the
name of the lab that ran the test. Real-world COAs word these labels a dozen
different ways ("Purity", "HPLC Purity", "Purity (HPLC)", "Purity (%)"), so
every field is matched against a list of label variants, tried top to bottom,
first match in the document wins.

This module only extracts text. It does not judge, normalize dates, or
resolve unit ambiguity beyond what's written - see purity.py and
redflags.py for the arithmetic and the checklist built on top of it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

# A COA is a short document. This cap is generous headroom over any real one
# and exists only to stop pathological input (e.g. someone piping in a huge
# file by mistake) from making the regex scan slow.
MAX_COA_TEXT_CHARS = 100_000

# Optional qualifier some COAs put in front of a percentage ("Purity: >=98%").
# Stripped and ignored; the number itself is what gets reported.
_QUALIFIER = r"(?:>=|<=|~|>|<|≥|≤)?\s*"

# A decimal number, accepting either a dot or a comma as the separator -
# COAs from outside the US/UK commonly write "98,99%" rather than "98.99%".
# _first_float_match normalizes the comma before calling float() on it.
_DECIMAL_VALUE = r"(\d+(?:[.,]\d+)?)"
_PCT_VALUE = _QUALIFIER + _DECIMAL_VALUE + r"\s*%?"


_PRODUCT_PATTERNS = [
    re.compile(r"^product\s*name\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^product\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^peptide\s*name\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^compound\s*name\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^item\s*name\s*[:\-]\s*(.+)$", re.IGNORECASE),
]

_PURITY_PATTERNS = [
    re.compile(
        r"^(?:hplc\s+)?purity\s*(?:\([^)]*\))?\s*[:\-]\s*" + _PCT_VALUE, re.IGNORECASE
    ),
]

_NET_CONTENT_PATTERNS = [
    re.compile(
        r"^net\s*peptide\s*content\s*(?:\([^)]*\))?\s*[:\-]\s*" + _PCT_VALUE, re.IGNORECASE
    ),
    re.compile(r"^net\s*content\s*(?:\([^)]*\))?\s*[:\-]\s*" + _PCT_VALUE, re.IGNORECASE),
    re.compile(r"^peptide\s*content\s*(?:\([^)]*\))?\s*[:\-]\s*" + _PCT_VALUE, re.IGNORECASE),
]

_MASS_PATTERNS = [
    re.compile(r"^net\s*weight\s*[:\-]\s*" + _DECIMAL_VALUE + r"\s*mg\b", re.IGNORECASE),
    re.compile(r"^quantity\s*[:\-]\s*" + _DECIMAL_VALUE + r"\s*mg\b", re.IGNORECASE),
    re.compile(r"^vial\s*(?:content|weight|size)\s*[:\-]\s*" + _DECIMAL_VALUE + r"\s*mg\b", re.IGNORECASE),
    re.compile(r"^fill\s*weight\s*[:\-]\s*" + _DECIMAL_VALUE + r"\s*mg\b", re.IGNORECASE),
    re.compile(r"^(?:mass|weight)\s*[:\-]\s*" + _DECIMAL_VALUE + r"\s*mg\b", re.IGNORECASE),
]

_BATCH_PATTERNS = [
    re.compile(r"^batch\s*/\s*lot\s*(?:no\.?|number)?\s*[:\-]\s*(\S+)", re.IGNORECASE),
    re.compile(r"^batch\s*(?:no\.?|number)?\s*[:\-]\s*(\S+)", re.IGNORECASE),
    re.compile(r"^lot\s*(?:no\.?|number)?\s*[:\-]\s*(\S+)", re.IGNORECASE),
]

_DATE_PATTERNS = [
    re.compile(r"^test\s*date\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^date\s*tested\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^date\s*of\s*analysis\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^analysis\s*date\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^report\s*date\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^coa\s*date\s*[:\-]\s*(.+)$", re.IGNORECASE),
]

_METHOD_PATTERNS = [
    re.compile(r"^test\s*method\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^testing\s*method\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^analytical\s*method\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^analysis\s*method\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^method\s*[:\-]\s*(.+)$", re.IGNORECASE),
]

_LAB_PATTERNS = [
    re.compile(r"^testing\s*laboratory\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^test(?:ing)?\s*lab\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^laboratory\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^tested\s*by\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^analyzed\s*by\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^lab\s*name\s*[:\-]\s*(.+)$", re.IGNORECASE),
    re.compile(r"^lab\s*[:\-]\s*(.+)$", re.IGNORECASE),
]


@dataclass(frozen=True)
class ParsedCoa:
    """Fields pulled out of a COA text blob. Any field can be missing (None).

    Values are copied verbatim from the document (stripped of surrounding
    whitespace only) - nothing here is interpreted, validated, or judged.
    That happens in purity.py (the math) and redflags.py (the checklist).
    """

    product_name: Optional[str] = None
    purity_pct: Optional[float] = None
    net_content_pct: Optional[float] = None
    mass_mg: Optional[float] = None
    batch_lot: Optional[str] = None
    test_date: Optional[str] = None
    method: Optional[str] = None
    lab_name: Optional[str] = None


def _first_text_match(lines: list[str], patterns: list[re.Pattern]) -> Optional[str]:
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        for pattern in patterns:
            m = pattern.match(stripped)
            if m:
                value = m.group(1).strip()
                if value:
                    return value
    return None


def _first_float_match(lines: list[str], patterns: list[re.Pattern]) -> Optional[float]:
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        for pattern in patterns:
            m = pattern.match(stripped)
            if m:
                try:
                    return float(m.group(1).replace(",", "."))
                except ValueError:
                    continue
    return None


def parse_coa(text: str) -> ParsedCoa:
    """Extract COA fields from a text blob.

    Scans line by line, top to bottom; for each field the first line that
    matches one of its known label variants wins. Missing fields come back
    as None rather than raising - a mostly-empty document is a valid (and
    useful) input, since a missing field is itself signal for the red-flag
    checklist in redflags.py.

    Raises:
        TypeError: if `text` isn't a str.
        ValueError: if `text` is larger than MAX_COA_TEXT_CHARS.
    """
    if not isinstance(text, str):
        raise TypeError(f"coa text must be a str, got {type(text).__name__}")
    if len(text) > MAX_COA_TEXT_CHARS:
        raise ValueError(
            f"input text is too large to parse ({len(text)} chars, "
            f"max {MAX_COA_TEXT_CHARS})"
        )

    lines = text.splitlines()
    return ParsedCoa(
        product_name=_first_text_match(lines, _PRODUCT_PATTERNS),
        purity_pct=_first_float_match(lines, _PURITY_PATTERNS),
        net_content_pct=_first_float_match(lines, _NET_CONTENT_PATTERNS),
        mass_mg=_first_float_match(lines, _MASS_PATTERNS),
        batch_lot=_first_text_match(lines, _BATCH_PATTERNS),
        test_date=_first_text_match(lines, _DATE_PATTERNS),
        method=_first_text_match(lines, _METHOD_PATTERNS),
        lab_name=_first_text_match(lines, _LAB_PATTERNS),
    )
