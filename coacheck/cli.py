"""Command-line interface for coacheck.

Subcommands:
    parse   Parse a COA (file or stdin), run the purity math and the
            red-flag checklist, print a report.
    recon   Reconstitution math: vial mg + water mL + a dose -> draw volume,
            insulin-syringe units, and doses per vial.

Pass --json to either subcommand for machine-readable output.
"""

from __future__ import annotations

import argparse
import sys

from . import __version__
from .parser import parse_coa
from .purity import compute_purity
from .recon import compute_recon
from .redflags import run_checklist
from .report import render_parse_human, render_parse_json, render_recon_human, render_recon_json

# Defense in depth ahead of parser.py's own (smaller) character cap: reject
# absurdly large input before it's even decoded.
MAX_INPUT_BYTES = 2_000_000


def _read_coa_text(path: str | None) -> str:
    if path is None:
        data = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    else:
        with open(path, "rb") as f:
            data = f.read(MAX_INPUT_BYTES + 1)
    if len(data) > MAX_INPUT_BYTES:
        raise ValueError(f"input is too large to read (max {MAX_INPUT_BYTES} bytes)")
    return data.decode("utf-8", errors="replace")


def cmd_parse(args: argparse.Namespace) -> int:
    try:
        text = _read_coa_text(args.file)
    except OSError as e:
        print(f"coacheck: {e}", file=sys.stderr)
        return 2
    except ValueError as e:
        print(f"coacheck: {e}", file=sys.stderr)
        return 1

    try:
        coa = parse_coa(text)
    except ValueError as e:
        print(f"coacheck: {e}", file=sys.stderr)
        return 1

    flags = run_checklist(coa)

    purity = None
    purity_error = None
    if coa.mass_mg is None:
        purity_error = "no mass/quantity (mg) found in the document"
    elif coa.purity_pct is None:
        purity_error = "no HPLC purity percentage found in the document"
    else:
        try:
            purity = compute_purity(coa.mass_mg, coa.purity_pct, coa.net_content_pct)
        except ValueError as e:
            purity_error = str(e)

    if args.json:
        print(render_parse_json(coa, flags, purity, purity_error))
    else:
        print(render_parse_human(coa, flags, purity, purity_error))
    return 0


def cmd_recon(args: argparse.Namespace) -> int:
    dose_mcg = args.dose if args.unit == "mcg" else args.dose * 1000.0
    try:
        result = compute_recon(args.vial, args.water, dose_mcg)
    except ValueError as e:
        print(f"coacheck: {e}", file=sys.stderr)
        return 1

    if args.json:
        print(render_recon_json(result))
    else:
        print(render_recon_human(result))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="coacheck",
        description="Certificate of Analysis parser and purity/reconstitution calculator. "
                    "Informational tool, not medical advice; does not endorse use of any compound.",
    )
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("parse", help="parse a COA and run the purity math + red-flag checklist")
    s.add_argument("file", nargs="?", default=None,
                    help="path to a COA text file (default: read from stdin)")
    s.add_argument("--json", action="store_true", help="machine-readable JSON output")
    s.set_defaults(func=cmd_parse)

    s = sub.add_parser("recon", help="reconstitution math: vial + water + dose -> draw")
    s.add_argument("--vial", type=float, required=True, help="peptide mass in the vial, in mg")
    s.add_argument("--water", type=float, required=True,
                    help="bacteriostatic water added, in mL")
    s.add_argument("--dose", type=float, required=True, help="dose to draw (in --unit)")
    s.add_argument("--unit", default="mcg", choices=["mcg", "mg"], help="unit of --dose (default: mcg)")
    s.add_argument("--json", action="store_true", help="machine-readable JSON output")
    s.set_defaults(func=cmd_recon)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
