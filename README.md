# coacheck

[![CI](https://github.com/munzzyy/coacheck/actions/workflows/ci.yml/badge.svg)](https://github.com/munzzyy/coacheck/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.9%2B-blue.svg)](pyproject.toml)

![coacheck parsing a COA with 99.2% purity but only 61.5% net peptide content, computing a 39% deliverable-mass shortfall and flagging a missing batch number and a placeholder lab name](docs/media/demo.svg)

This is an informational parsing and calculator tool. It does not endorse, recommend, source, or
facilitate the purchase of any compound, and nothing here is medical advice.

coacheck reads a Certificate of Analysis (COA) - the lab report that ships with a research
peptide vial - and does three things with it: extracts the fields (purity, batch number, test
method, and so on) with regex, checks that the document contains what a COA is supposed to
contain, and does the arithmetic to turn a labeled mass into a real deliverable mass and a
reconstituted vial into a syringe draw. It doesn't judge whether to use anything; it does the
math on what you give it.

## Install

Pure standard library, Python 3.9+, no runtime dependencies.

```bash
pipx install git+https://github.com/munzzyy/coacheck
```

There's no PyPI release yet, so install straight from the repo. Or clone it and run it in
place, which needs nothing installed at all:

```bash
git clone https://github.com/munzzyy/coacheck
cd coacheck
python -m coacheck parse tests/fixtures/coa_clean.txt   # run it directly, no install
pip install -e .                                        # or install the `coacheck` command
```

## Usage

### Parsing a COA

```
$ coacheck parse tests/fixtures/coa_clean.txt
Certificate of Analysis - parsed fields
  Product name        : Research Compound RC-118
  HPLC purity         : 99.1%
  Net peptide content : 91.5%
  Mass / quantity     : 5 mg
  Batch / lot         : RC118-20260214-A
  Test date           : 2026-02-14
  Test method         : RP-HPLC-MS
  Testing lab         : Meridian Analytical Labs

Purity math
  Labeled mass              : 5 mg
  Actual deliverable peptide: 4.534 mg (90.7% of labeled)
  Shortfall                 : 0.466 mg (9.3%)

Red-flag checklist
  [PASS] CC-PURITY        Purity at or above the research-grade line
         Stated purity is 99.1%.
  [PASS] CC-BATCH         Batch/lot number present
         Batch/lot: RC118-20260214-A
  [PASS] CC-LAB           Testing laboratory named
         Lab: Meridian Analytical Labs
  [PASS] CC-METHOD        Test method named
         Method: RP-HPLC-MS
  [PASS] CC-DATE          Test date present
         Test date: 2026-02-14
  [PASS] CC-PURITY-METHOD Purity is backed by a named method
         Method: RP-HPLC-MS
  [PASS] CC-NET           Net peptide content is within a plausible range
         Net peptide content: 91.5%

0 fail, 0 warn, 7 pass  (7 checks)
```

`coacheck parse` reads from a file, or from stdin if you leave the path off:

```bash
cat some-coa.txt | coacheck parse
```

Most real COAs arrive as a PDF. Convert it first and pipe it in. `-layout` matters: it keeps
the column alignment, and a COA is nearly always a two-column table.

```bash
pdftotext -layout coa.pdf - | coacheck parse
```

Pass `--json` for machine-readable output:

```bash
coacheck parse tests/fixtures/coa_clean.txt --json
```

`--fail-on` turns the checklist into an exit code so `parse` can gate a script. `--fail-on
fail` exits 3 when any check FAILs, `--fail-on warn` exits 3 on a WARN or a FAIL. The default
is `never`, which always exits 0.

```bash
coacheck parse coa.txt --fail-on fail && echo "nothing obviously missing"
```

### Reconstitution off a parsed COA

`parse` can do the reconstitution math too, and it uses the deliverable mass it just computed
rather than the number on the label:

```
$ coacheck parse tests/fixtures/coa_clean.txt --recon-water 2 --dose 250
...
Purity math
  Labeled mass              : 5 mg
  Actual deliverable peptide: 4.534 mg (90.7% of labeled)
  Shortfall                 : 0.466 mg (9.3%)

Reconstitution (from the actual deliverable mass, not the labeled 5 mg)
  Vial                : 4.53383 mg
  Bacteriostatic water: 2 mL
  Concentration       : 2266.91 mcg/mL
  Dose                : 250 mcg
  Draw                : 0.1103 mL (11.0 units on a U-100 insulin syringe)
  Doses per vial      : 18.14
...
```

The label implies 20.00 doses; the document's own purity figures say 18.14. Pass
`--recon-basis labeled` if you want the label number anyway. If the purity math couldn't run
there's no deliverable mass to use, and the block says so instead of quietly falling back.

### Reconstitution math

```
$ coacheck recon --vial 5 --water 2 --dose 250
Reconstitution
  Vial                : 5 mg
  Bacteriostatic water: 2 mL
  Concentration       : 2500 mcg/mL
  Dose                : 250 mcg
  Draw                : 0.1000 mL (10.0 units on a U-100 insulin syringe)
  Doses per vial      : 20.00
```

`--dose` is in mcg by default; pass `--unit mg` if you'd rather give it in mg. `--json` works
here too.

## Browser extension

`extension/` is a Manifest V3 browser extension (Firefox and Chrome, one codebase) that
does the same parsing and math without the command line: drag a box over a COA on any page,
it OCRs that region locally - bundled OCR engine, no network call, nothing leaves your
machine - and shows the parsed fields, purity math, a reconstitution calculator, and the
red-flag checklist right there on the page. See [extension/README.md](extension/README.md)
for how to load it, the exact permissions it asks for and why, and how its JS port of this
engine is pinned to match the Python package exactly.

## What it checks / does

- Parses a COA text blob for product name, HPLC purity, net peptide content, mass/quantity,
  batch/lot number, test date, test method, and testing lab, tolerating the label wording real
  vendor documents vary ("Purity", "HPLC Purity", "Purity (HPLC)", colon, equals or dash
  separators, case-insensitive). It also reads two-column table rows with nothing but
  whitespace between label and value, which is what `pdftotext -layout` and the extension's OCR
  produce. Purity bounds written as words ("NLT 98.0%", "min. 98.0%") count the same as `>=`,
  and a mass in mcg, ug or g is normalized to mg. See [docs/checks.md](docs/checks.md) for the
  exact formulas.
- Computes actual deliverable peptide mass from labeled mass, purity, and (if stated) net
  peptide content, plus the shortfall against the label in both mg and percent.
- Runs a 7-item red-flag checklist (`CC-PURITY`, `CC-BATCH`, `CC-LAB`, `CC-METHOD`, `CC-DATE`,
  `CC-PURITY-METHOD`, `CC-NET`), each a stable id with a pass/warn/fail status, documented in
  [docs/checks.md](docs/checks.md).
- Computes reconstitution math: concentration, mL to draw, units on a U-100 insulin syringe, and
  doses per vial, from a vial mass, diluent volume, and a dose you supply. Run off a parsed COA
  it uses the deliverable mass, not the labeled one.

## What it does not do

- It does not verify that a COA is genuine. A fabricated document can fill in every field with
  invented numbers and pass every check here; this tool checks for missing or impossible data,
  not for forgery.
- It does not check a batch number, lab name, or test date against any outside registry. Every
  field is taken at face value from the text you give it.
- It does not recommend a dose, a product, or a source. `recon` computes whatever `--dose` you
  pass it; it has no opinion on what that number should be.
- The `coacheck` CLI is a regex parser over plain text. It doesn't do OCR and doesn't read PDFs
  or images (the browser extension does OCR, see above; for a PDF, pipe `pdftotext -layout`
  into it). It can also miss a field worded in a way none of its label patterns cover - see
  [CONTRIBUTING.md](CONTRIBUTING.md) if you hit one.
- No network calls, no telemetry, nothing phones home.

## Exit codes

- `0` - ran to completion. This is independent of the red-flag results: a report full of FAIL
  flags still exits `0`, because a failed check is information, not a tool error.
- `1` - invalid input: unparseable arguments to `recon`'s math, or a COA text blob that's
  oversized or the wrong type.
- `2` - couldn't read the input at all (file not found) or a command-line usage error.
- `3` - only with `--fail-on warn` or `--fail-on fail` on `parse`: the run succeeded and the
  checklist came back at or above the level you asked to fail on. Without the flag this code
  never happens.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New label variants and new checks land with a test.

## License

MIT. Free to use, change, and ship, commercial or not. See [LICENSE](LICENSE).

## Support

If coacheck saved you from a thin COA, [sponsoring](https://github.com/sponsors/munzzyy) is what keeps it maintained.
