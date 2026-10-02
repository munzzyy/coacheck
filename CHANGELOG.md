# Changelog

## [Unreleased]

## [0.2.0] - 2026-10-02

- New CC-MASS check. A COA with no usable mass or quantity used to pass all seven checks even
  though the purity and reconstitution math both need the mass.
- A purity stated only as an upper bound (`<98%` or `NMT 98%`) no longer feeds the purity math.
  CC-PURITY warns and `parse --recon-water` refuses the actual-mass basis.
- The same now goes for an upper-bound net peptide content. CC-NET warns and the math is
  skipped with a reason.
- On a table laid out as Test, Specification and Result the parser reads the measured result
  instead of the spec bound. A COA that measured 95.1% against an NLT 98.0% spec used to pass
  CC-PURITY at 98%. A Method column between the label and the spec no longer loses the purity.
- A mass is no longer read as a percentage. `Peptide Content: 5mg` used to come out as 5% net
  content.
- `Net Content: 10 mg` now counts as the vial mass.
- A molar mass like `Weight: 1419.53 g/mol` is no longer taken for the fill.
- More label wordings parse:
  - purity: `Peptide Purity (HPLC)`, `Purity by HPLC`, `Purity [HPLC]`, `Purity, HPLC` and
    dot leaders
  - batch: `Batch #`, `Lot #`, `Lot#`, `Batch Code` and `Batch ID`
  - lab and date: `Laboratory Name`, `Date of Test` and `Testing Date`
- The CLI no longer crashes with a UnicodeEncodeError when stdout can't encode the report, as
  with a cp1252 redirect on Windows. Characters it can't encode print as escapes.
- The extension enlarges a small crop up to 3x before OCR. Text at 10 to 12 px on a 1x screen
  used to lose the purity, and once read a net content of 91.5% as 915%.
- The extension's results panel can be used from the keyboard and is labeled for screen
  readers. It has a real Close button, named inputs, a labeled region and live updates for
  the calculator. It takes focus when it opens and Esc closes it on the page.
- An end-to-end smoke test runs the real extension in headless Chromium (`npm run e2e`).
- On a page browsers keep extensions off, like `chrome://` pages or an extension store, the
  select button used to close the popup and do nothing. The popup now stays open, says it
  can't read the page and points at the paste box. The keyboard shortcut puts a **!** on the
  toolbar button for that tab instead.
- A manual run of the release workflow can no longer publish from a branch. Only the tag
  matching the package version publishes.
- The sdist now carries the test helpers and fixtures, so its test suite runs.
- CI tests Python 3.9 through 3.14.
- Relicensed from MIT to GPL-3.0-or-later. The v0.1.0 tag stays MIT.

## [0.1.0] - 2026-08-02

First tagged version, under MIT.

- `coacheck parse` pulls the fields out of a COA's text and does the deliverable-mass math
  from purity and net peptide content. It runs a seven-check red-flag checklist and prints
  text or `--json`.
- `coacheck recon` does the reconstitution math. `parse --recon-water` runs it on the mass the
  vial actually delivers.
- A Firefox and Chrome extension that OCRs a dragged region of the page locally and runs a
  JS port of the same engine, pinned to the Python one by a parity test.

[Unreleased]: https://github.com/munzzyy/coacheck/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/munzzyy/coacheck/tree/v0.2.0
[0.1.0]: https://github.com/munzzyy/coacheck/tree/v0.1.0
