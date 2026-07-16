#!/usr/bin/env python3
"""gen_fixtures.py - runs the real Python coacheck package over every case in cases.json
and writes each result to fixtures/<name>.json.

This is one half of the web-parity gate: check.mjs (Node) runs the SAME cases through the
JS port under extension/engine/ and deep-equals the two. If they disagree, the JS is wrong -
fix the JS to match this output, never the other way around.

fixtures/ is regenerated every run (gitignored, not committed) so there's never a stale
fixture sitting around disagreeing with a since-changed Python engine.

Run:  python tests/web_parity/gen_fixtures.py
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CASES_PATH = os.path.join(HERE, "cases.json")
FIXTURES_DIR = os.path.join(HERE, "..", "fixtures")
OUT_DIR = os.path.join(HERE, "fixtures")

# Make sure "coacheck" imports even if the package isn't pip-installed in this environment.
sys.path.insert(0, os.path.join(HERE, "..", ".."))

from coacheck._serialize import to_dict  # noqa: E402
from coacheck.parser import ParsedCoa, parse_coa  # noqa: E402
from coacheck.purity import compute_purity  # noqa: E402
from coacheck.recon import compute_recon  # noqa: E402
from coacheck.redflags import run_checklist  # noqa: E402


def run_parse_case(case: dict) -> dict:
    if "fixture" in case:
        with open(os.path.join(FIXTURES_DIR, case["fixture"]), "r", encoding="utf-8") as f:
            text = f.read()
    else:
        text = case["text"]

    coa = parse_coa(text)
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

    return {
        "fields": to_dict(coa),
        "flags": to_dict(flags),
        "purity": to_dict(purity) if purity is not None else None,
        "purity_error": purity_error,
    }


def run_purity_case(case: dict) -> dict:
    result = compute_purity(case["labeled_mg"], case["purity_pct"], case.get("net_content_pct"))
    return to_dict(result)


def run_recon_case(case: dict) -> dict:
    result = compute_recon(case["vial_mg"], case["water_ml"], case["dose_mcg"])
    return to_dict(result)


def run_redflags_case(case: dict) -> dict:
    coa = ParsedCoa(**case["coa"])
    return to_dict(run_checklist(coa))


_RUNNERS = {
    "parse": run_parse_case,
    "purity": run_purity_case,
    "recon": run_recon_case,
    "redflags": run_redflags_case,
}


def run_case(case: dict) -> dict:
    runner = _RUNNERS.get(case["type"])
    if runner is None:
        raise ValueError(f"unknown case type {case['type']!r} in {case.get('name')!r}")
    return runner(case)


def main() -> int:
    with open(CASES_PATH, "r", encoding="utf-8") as f:
        cases = json.load(f)

    names = [c["name"] for c in cases]
    dupes = {n for n in names if names.count(n) > 1}
    if dupes:
        print(f"error: duplicate case names in cases.json: {sorted(dupes)}", file=sys.stderr)
        return 2

    os.makedirs(OUT_DIR, exist_ok=True)
    for case in cases:
        try:
            out = run_case(case)
        except Exception as e:  # noqa: BLE001 - a fixture that can't generate is a hard failure
            print(f"error generating fixture {case['name']!r}: {type(e).__name__}: {e}", file=sys.stderr)
            return 1
        with open(os.path.join(OUT_DIR, f"{case['name']}.json"), "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2, sort_keys=True)
            f.write("\n")

    print(f"wrote {len(cases)} fixtures to {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
