# Contributing

Thanks for looking at this. It's a small, single-purpose tool and contributions are welcome.

## Setup

```
git clone https://github.com/munzzyy/coacheck
cd coacheck
```

There's nothing to install. coacheck is pure standard library, and so is its test suite.

## Running the tests

```
python -m unittest discover -s tests -t .
```

That's the whole suite: parser tests, math tests (hand-verified expected numbers), red-flag
checklist tests, and CLI tests, plus a set of synthetic COA fixtures in `tests/fixtures/`. CI
runs the same command across Linux, macOS, and Windows on Python 3.9 through 3.13.

## Adding a label variant to the parser

Real COAs word the same field a dozen ways. If you hit a real (or realistic synthetic) COA where
a field goes unparsed because of wording this tool doesn't recognize yet, add the new label
pattern to `coacheck/parser.py` and a fixture under `tests/fixtures/` that exercises it. A fixture
without a matching test doesn't count - the fix has to stay fixed.

## Adding a red-flag check

Every check in `coacheck/redflags.py` returns exactly one `Flag` with a stable id (`CC-...`).
New checks need a test for each of their pass/warn/fail branches - see `tests/test_redflags.py`
for the shape.

## Zero dependencies

coacheck has no runtime dependencies and that's a feature. If a change needs a new package,
that's a reason to reconsider the change, not a to-do.

## License

By opening a PR you agree your contribution is offered under the project's MIT license.
