# Contributing

Thanks for looking at this. It's a small, single-purpose tool and contributions are welcome.
Issues and pull requests go to https://github.com/munzzyy/coacheck.

## Setup

```
git clone https://github.com/munzzyy/coacheck
cd coacheck
```

There's nothing to install. coacheck is pure standard library, and so is its Python test suite.

## Running the tests

```
python -m unittest discover -s tests -t .
```

That's the Python suite: parser tests, math tests (hand-verified expected numbers), red-flag
checklist tests and CLI tests. They run over a set of synthetic COA fixtures in
`tests/fixtures/`. CI runs the same command across Linux, macOS and Windows on Python 3.9
through 3.14.

The browser extension runs a JS port of the same engine, so anything under `coacheck/` that
changes parsing or math has a twin under `extension/engine/`. Its tests need Node and nothing
from npm:

```
node --test tests/js/*.test.mjs
python3 tests/web_parity/gen_fixtures.py && node tests/web_parity/check.mjs
```

The second line runs every case in `tests/web_parity/cases.json` through both engines and
compares the results. When they disagree, the JS is the one to fix.

## Adding a label variant to the parser

Real COAs word the same field a dozen ways. If you hit a real (or realistic synthetic) COA where
a field goes unparsed because of wording this tool doesn't recognize yet:

1. Add the label pattern to `coacheck/parser.py` and the same pattern to
   `extension/engine/parser.js`.
2. Add a test for it to `tests/test_parser.py` and to `tests/js/engine.test.mjs`.
3. Add a case to `tests/web_parity/cases.json`, either the line itself or a new synthetic
   fixture under `tests/fixtures/`. `gen_fixtures.py` stops with an error when a fixture has no
   case.
4. Run the Python suite, `node --test tests/js/*.test.mjs` and
   `python3 tests/web_parity/gen_fixtures.py && node tests/web_parity/check.mjs`.

A fixture without a matching test doesn't count - the fix has to stay fixed. Keep fixtures
synthetic: no real vendor COAs, lab names or batch numbers.

## Adding a red-flag check

Every check in `coacheck/redflags.py` returns exactly one `Flag` with a stable id (`CC-...`).
New checks need a test for each of their pass/warn/fail branches - see `tests/test_redflags.py`
for the shape. The same check goes into `extension/engine/redflags.js` with parity cases for
each branch.

## Zero dependencies

coacheck has no runtime dependencies and that's a feature. If a change needs a new package,
that's a reason to reconsider the change, not a to-do.

## License

By opening a PR you agree your contribution is offered under the project's GPL-3.0-or-later license.
