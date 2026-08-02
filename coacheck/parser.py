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

import math
import re
from dataclasses import dataclass
from typing import Optional

# A COA is a short document. This cap is generous headroom over any real one
# and exists only to stop pathological input (e.g. someone piping in a huge
# file by mistake) from making the regex scan slow.
MAX_COA_TEXT_CHARS = 100_000

# What separates a label from its value. A colon or an equals sign always does.
# A dash only counts when whitespace comes before it, because label names carry
# their own hyphens ("Lot-Nr", "Batch-No", "Lab-tested") and splitting on a bare
# dash reads the tail of the label as the value - non-empty garbage that then
# passes the checklist. The lookbehind is zero-width so the label pattern's own
# \s* stays the only whitespace run in front of the separator; two adjacent \s*
# runs are what makes the scan quadratic on a long stretch of spaces.
#
# Built from code points, not literals, so this source file stays plain ASCII:
# OCR of a printed COA turns plenty of hyphens into a long dash, so those count
# as separators too.
_LONG_DASHES = chr(0x2013) + chr(0x2014)
_SEP = r"(?::|=|(?<=\s)[-" + _LONG_DASHES + r"])\s*"

# The same characters, for the column-gap test in _segments below.
_SEP_CHARS = ":=-" + _LONG_DASHES

# Optional qualifier some COAs put in front of a percentage ("Purity: >=98%").
# Captured so the checklist can tell a confirmed value from a bound: "<98%" is
# an upper bound, not a claim that purity is 98%. Pharma COAs write the same
# bounds as words at least as often as symbols ("NLT 98.0%", "min. 98.0%"), so
# those are matched too and normalized to the symbol they mean.
_QUALIFIER = (
    r"(?:(>=|<=|~|>|<|≥|≤"
    r"|not\s+less\s+than|not\s+more\s+than|greater\s+than|less\s+than"
    r"|nlt|nmt|min(?:imum)?\.?|max(?:imum)?\.?)\s*)?"
)

_QUALIFIER_WORDS = {
    "nlt": ">=", "not less than": ">=", "min": ">=", "min.": ">=",
    "minimum": ">=", "minimum.": ">=",
    "nmt": "<=", "not more than": "<=", "max": "<=", "max.": "<=",
    "maximum": "<=", "maximum.": "<=",
    "greater than": ">", "less than": "<",
}

# A decimal number, accepting either a dot or a comma as the separator -
# COAs from outside the US/UK commonly write "98,99%" rather than "98.99%".
# ASCII digits only, on purpose: the JS port's \d is ASCII, so pinning Python
# to [0-9] keeps the two engines matching on non-ASCII digit input.
# _to_float sorts out comma-as-decimal vs comma-as-thousands-separator.
_DECIMAL_VALUE = r"([0-9]+(?:[.,][0-9]+)?)"
_PCT_VALUE = _QUALIFIER + _DECIMAL_VALUE + r"\s*%?"

# A number written with commas as thousands separators ("1,000", "5,000").
# Told apart from a comma decimal ("98,99") so "1,000 mg" isn't read as 1 mg.
_THOUSANDS_GROUPED = re.compile(r"^[0-9]{1,3}(?:,[0-9]{3})+$")

# Vials get labeled in more than mg. Everything is normalized to mg so the
# purity and reconstitution math downstream only ever sees one unit. "mcg" has
# to be tried before "g" or the alternation matches the tail of it.
_MASS_UNIT = r"\s*(mcg|" + chr(0x00B5) + r"g|" + chr(0x03BC) + r"g|ug|mg|g)\b"

_MASS_UNIT_TO_MG = {
    "mg": 1.0,
    "mcg": 0.001,
    chr(0x00B5) + "g": 0.001,
    chr(0x03BC) + "g": 0.001,
    "ug": 0.001,
    "g": 1000.0,
}

# Whitespace wide enough to read as a column gap in a table-shaped COA. A single
# space is not one: "Sample Peptide SP-200" is one value, not three.
_COLUMN_GAP = re.compile(r"\t+|[ \t]{2,}")

# A COA line holds a handful of columns. Past this it isn't a table, it's a wall
# of text, and running every label pattern over every piece of it would cost more
# than it could ever find.
MAX_LINE_SEGMENTS = 32


_PRODUCT_PATTERNS = [
    re.compile(r"^product\s*name\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^product\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^peptide\s*name\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^compound\s*name\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^item\s*name\s*" + _SEP + r"(.+)$", re.IGNORECASE),
]

# The trailing whitespace is pulled inside the optional group (e.g.
# "(?:\([^)]*\)\s*)?" rather than "(?:\([^)]*\))?\s*") so there are never two
# free-floating \s* runs on either side of an empty-matchable group - that
# adjacency is what makes the scan quadratic on a long run of whitespace.
_PURITY_PATTERNS = [
    re.compile(
        r"^(?:hplc\s+)?purity\s*(?:\([^)]*\)\s*)?" + _SEP + _PCT_VALUE, re.IGNORECASE
    ),
]

_NET_CONTENT_PATTERNS = [
    re.compile(
        r"^net\s*peptide\s*content\s*(?:\([^)]*\)\s*)?" + _SEP + _PCT_VALUE, re.IGNORECASE
    ),
    re.compile(r"^net\s*content\s*(?:\([^)]*\)\s*)?" + _SEP + _PCT_VALUE, re.IGNORECASE),
    re.compile(r"^peptide\s*content\s*(?:\([^)]*\)\s*)?" + _SEP + _PCT_VALUE, re.IGNORECASE),
]

_MASS_PATTERNS = [
    re.compile(r"^net\s*weight\s*" + _SEP + _DECIMAL_VALUE + _MASS_UNIT, re.IGNORECASE),
    re.compile(r"^quantity\s*" + _SEP + _DECIMAL_VALUE + _MASS_UNIT, re.IGNORECASE),
    re.compile(r"^vial\s*(?:content|weight|size)\s*" + _SEP + _DECIMAL_VALUE + _MASS_UNIT, re.IGNORECASE),
    re.compile(r"^fill\s*weight\s*" + _SEP + _DECIMAL_VALUE + _MASS_UNIT, re.IGNORECASE),
    re.compile(r"^(?:mass|weight)\s*" + _SEP + _DECIMAL_VALUE + _MASS_UNIT, re.IGNORECASE),
]

# "(?:\s*-)?" rather than "\s*-?" for the hyphenated spellings ("Batch-No"):
# an optional single character between two \s* runs is the quadratic shape again.
_BATCH_LABEL_TAIL = r"(?:\s*-)?\s*(?:(?:no\.?|nr\.?|number)\s*)?"

# A batch number can carry internal spaces ("RC 118 A"). The old \S+ capture cut
# it off at the first one; the value now runs to the end of the segment, and
# _segments has already cut the segment off at the next column.
_BATCH_PATTERNS = [
    re.compile(r"^batch\s*/\s*lot" + _BATCH_LABEL_TAIL + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^batch" + _BATCH_LABEL_TAIL + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^lot" + _BATCH_LABEL_TAIL + _SEP + r"(.+)$", re.IGNORECASE),
]

_DATE_PATTERNS = [
    re.compile(r"^test\s*date\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^date\s*tested\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^date\s*of\s*analysis\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^analysis\s*date\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^report\s*date\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^coa\s*date\s*" + _SEP + r"(.+)$", re.IGNORECASE),
]

_METHOD_PATTERNS = [
    re.compile(r"^test\s*method\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^testing\s*method\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^analytical\s*method\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^analysis\s*method\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^method\s*" + _SEP + r"(.+)$", re.IGNORECASE),
]

_LAB_PATTERNS = [
    re.compile(r"^testing\s*laboratory\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^test(?:ing)?\s*lab\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^laboratory\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^tested\s*by\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^analyzed\s*by\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^lab\s*name\s*" + _SEP + r"(.+)$", re.IGNORECASE),
    re.compile(r"^lab\s*" + _SEP + r"(.+)$", re.IGNORECASE),
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
    purity_qualifier: Optional[str] = None
    net_content_pct: Optional[float] = None
    net_content_qualifier: Optional[str] = None
    mass_mg: Optional[float] = None
    batch_lot: Optional[str] = None
    test_date: Optional[str] = None
    method: Optional[str] = None
    lab_name: Optional[str] = None


def _segments(line: str) -> list[str]:
    """Cut a line into the columns it holds.

    Real COAs, and the OCR of one, are mostly two-column tables: the label on
    the left, the value some distance to the right, with nothing but whitespace
    between them. A wide gap is a column boundary. A gap that touches a
    separator is not - "Purity   :    98.5 %" is one field with padding around
    its colon, not three columns.
    """
    parts: list[str] = []
    start = 0
    for gap in _COLUMN_GAP.finditer(line):
        before = line[gap.start() - 1] if gap.start() else ""
        after = line[gap.end()] if gap.end() < len(line) else ""
        if before in _SEP_CHARS or after in _SEP_CHARS:
            continue
        piece = line[start:gap.start()].strip()
        if piece:
            parts.append(piece)
        start = gap.end()
        if len(parts) >= MAX_LINE_SEGMENTS:
            return parts
    tail = line[start:].strip()
    if tail:
        parts.append(tail)
    return parts


def _candidates(line: str) -> tuple[list[str], list[str]]:
    """The label/value strings a line could hold, in two tiers.

    The first tier is the columns themselves, which is where a line carrying
    two complete fields ("Test Method: RP-HPLC    Test Date: 2026-02-14") gets
    read correctly instead of the first field swallowing the second. The second
    tier joins each neighbouring pair of columns with a colon, which is what
    makes a punctuation-free table row ("Purity (HPLC)      99.1 %") parse at
    all. Tier one is tried first for every pattern, so a line that already
    spells out its separator never gets reinterpreted as a table row.
    """
    segments = _segments(line)
    if len(segments) < 2:
        return segments, []
    joined = [f"{segments[i]}: {segments[i + 1]}" for i in range(len(segments) - 1)]
    return segments, joined


def _iter_matches(lines: list[str], patterns: list[re.Pattern]):
    """Yield every pattern match across the document, in priority order."""
    for line in lines:
        direct, joined = _candidates(line)
        for tier in (direct, joined):
            for candidate in tier:
                for pattern in patterns:
                    m = pattern.match(candidate)
                    if m:
                        yield m


def _first_text_match(lines: list[str], patterns: list[re.Pattern]) -> Optional[str]:
    for m in _iter_matches(lines, patterns):
        value = m.group(1).strip()
        if value:
            return value
    return None


def _to_float(token: str) -> Optional[float]:
    """Parse a captured numeric token to a float, or None if it isn't usable.

    Commas are read as thousands separators when the token is grouped like
    "1,000" and as a decimal point otherwise ("98,99"). A token that overflows
    to infinity (an absurdly long run of digits) returns None rather than a
    non-finite float the rest of the pipeline can't use or serialize.
    """
    if _THOUSANDS_GROUPED.match(token):
        normalized = token.replace(",", "")
    else:
        normalized = token.replace(",", ".")
    try:
        value = float(normalized)
    except ValueError:
        return None
    if not math.isfinite(value):
        return None
    return value


def _first_mass_match(lines: list[str], patterns: list[re.Pattern]) -> Optional[float]:
    """The first labeled mass in the document, converted to mg.

    Group 1 is the number, group 2 the unit it was written in. A unit the
    conversion table doesn't know is skipped rather than guessed at, so the
    field comes back missing instead of wrong by a factor of a thousand.
    """
    for m in _iter_matches(lines, patterns):
        value = _to_float(m.group(1))
        factor = _MASS_UNIT_TO_MG.get(m.group(2).lower())
        if value is not None and factor is not None:
            return value * factor
    return None


def _normalize_qualifier(token: Optional[str]) -> Optional[str]:
    """Map a word-form qualifier onto the symbol it means.

    "NLT 98%" and ">=98%" say the same thing, and redflags.py only knows the
    symbols, so the words are folded into them here. Symbols pass through
    untouched so the report still shows a document its own notation back.
    """
    if token is None:
        return None
    return _QUALIFIER_WORDS.get(re.sub(r"\s+", " ", token.strip().lower()), token)


def _first_pct_match(
    lines: list[str], patterns: list[re.Pattern]
) -> tuple[Optional[float], Optional[str]]:
    """Like _first_mass_match, but for a percentage that may carry a leading
    qualifier ("<98.5%", ">=99%", "NLT 98%"). Returns (value, qualifier); the
    qualifier is None when none was written."""
    for m in _iter_matches(lines, patterns):
        value = _to_float(m.group(2))
        if value is not None:
            return value, _normalize_qualifier(m.group(1))
    return None, None


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

    # A leading UTF-8 BOM (U+FEFF) isn't whitespace and survives str.strip(),
    # so it would keep the first line from matching a label. Drop it here so
    # library callers and the stdin path get the same treatment the CLI's
    # utf-8-sig decode gives a file.
    text = text.lstrip("\ufeff")

    lines = text.splitlines()
    purity_pct, purity_qualifier = _first_pct_match(lines, _PURITY_PATTERNS)
    net_content_pct, net_content_qualifier = _first_pct_match(lines, _NET_CONTENT_PATTERNS)
    return ParsedCoa(
        product_name=_first_text_match(lines, _PRODUCT_PATTERNS),
        purity_pct=purity_pct,
        purity_qualifier=purity_qualifier,
        net_content_pct=net_content_pct,
        net_content_qualifier=net_content_qualifier,
        mass_mg=_first_mass_match(lines, _MASS_PATTERNS),
        batch_lot=_first_text_match(lines, _BATCH_PATTERNS),
        test_date=_first_text_match(lines, _DATE_PATTERNS),
        method=_first_text_match(lines, _METHOD_PATTERNS),
        lab_name=_first_text_match(lines, _LAB_PATTERNS),
    )
