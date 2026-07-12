"""Render parse and recon results as human-readable text or JSON."""

from __future__ import annotations

import json
from typing import Optional

from . import __version__
from ._serialize import to_dict
from .parser import ParsedCoa
from .purity import PurityResult
from .recon import ReconResult
from .redflags import Flag, Status

_FIELD_LABELS = (
    ("product_name", "Product name"),
    ("purity_pct", "HPLC purity"),
    ("net_content_pct", "Net peptide content"),
    ("mass_mg", "Mass / quantity"),
    ("batch_lot", "Batch / lot"),
    ("test_date", "Test date"),
    ("method", "Test method"),
    ("lab_name", "Testing lab"),
)


def _field_text(coa: ParsedCoa, name: str) -> str:
    value = getattr(coa, name)
    if value is None:
        return "(not found)"
    if name in ("purity_pct", "net_content_pct"):
        return f"{value:g}%"
    if name == "mass_mg":
        return f"{value:g} mg"
    return str(value)


def render_parse_human(
    coa: ParsedCoa,
    flags: list[Flag],
    purity: Optional[PurityResult],
    purity_error: Optional[str],
) -> str:
    lines: list[str] = []
    lines.append("Certificate of Analysis - parsed fields")
    width = max(len(label) for _name, label in _FIELD_LABELS)
    for name, label in _FIELD_LABELS:
        lines.append(f"  {label.ljust(width)} : {_field_text(coa, name)}")

    lines.append("")
    lines.append("Purity math")
    if purity is not None:
        lines.append(f"  Labeled mass              : {purity.labeled_mg:g} mg")
        lines.append(
            f"  Actual deliverable peptide: {purity.actual_mg:.3f} mg "
            f"({100.0 - purity.shortfall_pct:.1f}% of labeled)"
        )
        lines.append(
            f"  Shortfall                 : {purity.shortfall_mg:.3f} mg "
            f"({purity.shortfall_pct:.1f}%)"
        )
    else:
        lines.append(f"  Not computed: {purity_error}")

    lines.append("")
    lines.append("Red-flag checklist")
    for flag in flags:
        lines.append(f"  [{flag.status.value.upper():>4}] {flag.id:<16} {flag.title}")
        lines.append(f"         {flag.detail}")

    counts = {s: 0 for s in Status}
    for flag in flags:
        counts[flag.status] += 1
    lines.append("")
    lines.append(
        f"{counts[Status.FAIL]} fail, {counts[Status.WARN]} warn, "
        f"{counts[Status.PASS]} pass  ({len(flags)} checks)"
    )
    return "\n".join(lines)


def render_parse_json(
    coa: ParsedCoa,
    flags: list[Flag],
    purity: Optional[PurityResult],
    purity_error: Optional[str],
) -> str:
    payload = {
        "tool": "coacheck",
        "version": __version__,
        "fields": to_dict(coa),
        "purity": to_dict(purity) if purity is not None else None,
        "purity_error": purity_error if purity is None else None,
        "flags": to_dict(flags),
    }
    return json.dumps(payload, indent=2)


def render_recon_human(result: ReconResult) -> str:
    lines = [
        "Reconstitution",
        f"  Vial                : {result.vial_mg:g} mg",
        f"  Bacteriostatic water: {result.water_ml:g} mL",
        f"  Concentration       : {result.concentration_mcg_per_ml:g} mcg/mL",
        f"  Dose                : {result.dose_mcg:g} mcg",
        f"  Draw                : {result.ml_per_dose:.4f} mL "
        f"({result.units_per_dose:.1f} units on a U-100 insulin syringe)",
        f"  Doses per vial      : {result.doses_per_vial:.2f}",
    ]
    if result.exceeds_vial:
        lines.append("  Note: this dose is larger than the whole vial's peptide content.")
    return "\n".join(lines)


def render_recon_json(result: ReconResult) -> str:
    payload = {"tool": "coacheck", "version": __version__, "recon": to_dict(result)}
    return json.dumps(payload, indent=2)
