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
from .redflags import Status, run_checklist
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
    # utf-8-sig strips a leading BOM (which some exporters emit) that would
    # otherwise cling to the first line and stop it matching a label.
    return data.decode("utf-8-sig", errors="replace")


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

    recon, recon_error, recon_basis = _parse_recon(args, coa, purity, purity_error)

    if args.json:
        print(render_parse_json(coa, flags, purity, purity_error, recon, recon_error, recon_basis))
    else:
        print(render_parse_human(coa, flags, purity, purity_error, recon, recon_error, recon_basis))
    return _fail_code(args.fail_on, flags)


def _parse_recon(
    args: argparse.Namespace,
    coa,
    purity,
    purity_error: str | None,
) -> tuple[object | None, str | None, str | None]:
    """Reconstitution math for `parse`, or (None, None, None) if none was asked for.

    The default basis is the deliverable mass the purity block just computed,
    not the labeled mass. Reporting that a 5 mg vial really holds 4.534 mg and
    then dividing 5 mg into doses is the tool contradicting itself on the same
    screen. `--recon-basis labeled` opts back into the label figure.

    When the requested basis isn't available the block says so and says which
    flag would change that; it never quietly falls back to the other mass.
    """
    if args.recon_water is None:
        return None, None, None

    basis = args.recon_basis
    dose_mcg = args.dose if args.unit == "mcg" else args.dose * 1000.0

    if basis == "actual":
        if purity is None:
            return None, (
                f"{purity_error}, so there is no deliverable mass to compute from. "
                "Pass --recon-basis labeled to use the mass on the label instead."
            ), basis
        vial_mg = purity.actual_mg
    else:
        if coa.mass_mg is None:
            return None, "no mass/quantity found in the document", basis
        vial_mg = coa.mass_mg

    try:
        return compute_recon(vial_mg, args.recon_water, dose_mcg), None, basis
    except ValueError as e:
        return None, str(e), basis


def _fail_code(fail_on: str, flags: list) -> int:
    """Exit code for `parse` under --fail-on.

    Default is `never`: a failed check is information, not a tool error, and
    that contract is documented. The other two modes return 3 so they can never
    be confused with 1 (invalid input) or 2 (unreadable input / usage error).
    """
    if fail_on == "fail" and any(f.status is Status.FAIL for f in flags):
        return 3
    if fail_on == "warn" and any(f.status in (Status.FAIL, Status.WARN) for f in flags):
        return 3
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
    s.add_argument("--recon-water", type=float, default=None, metavar="ML",
                    help="also do the reconstitution math, with this much bacteriostatic "
                         "water in mL (requires --dose)")
    s.add_argument("--dose", type=float, default=None,
                    help="dose to draw (in --unit), for --recon-water")
    s.add_argument("--unit", default="mcg", choices=["mcg", "mg"],
                    help="unit of --dose (default: mcg)")
    s.add_argument("--recon-basis", default="actual", choices=["actual", "labeled"],
                    help="mass the reconstitution math runs on: the deliverable mass computed "
                         "from purity (default) or the mass printed on the label")
    s.add_argument("--fail-on", default="never", choices=["never", "warn", "fail"],
                    help="exit 3 when the checklist has a FAIL, or a WARN or FAIL "
                         "(default: never, which always exits 0)")
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
    if args.cmd == "parse" and (args.recon_water is None) != (args.dose is None):
        parser.error("--recon-water and --dose have to be given together")
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
