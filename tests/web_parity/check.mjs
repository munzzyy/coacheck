#!/usr/bin/env node
/*
 * check.mjs - runs the JS port (extension/engine/) over the same cases.json fixtures
 * gen_fixtures.py just generated from the real Python coacheck package, and deep-equals the
 * two. Any drift between the extension's engine and coacheck/parser.py, purity.py, recon.py,
 * redflags.py shows up here (and in CI) instead of silently shipping a wrong answer.
 *
 * Run (after `python tests/web_parity/gen_fixtures.py`):
 *   node tests/web_parity/check.mjs
 *
 * Exit 0 = every fixture matches, 1 = a mismatch or a missing/unreadable fixture.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const ENGINE_DIR = path.join(REPO_ROOT, "extension", "engine");
const FIXTURES_TEXT_DIR = path.join(REPO_ROOT, "tests", "fixtures");
const FIXTURES_DIR = path.join(HERE, "fixtures");
const CASES_PATH = path.join(HERE, "cases.json");

const { parseCoa } = await import(path.join(ENGINE_DIR, "parser.js"));
const { computePurity } = await import(path.join(ENGINE_DIR, "purity.js"));
const { computeRecon } = await import(path.join(ENGINE_DIR, "recon.js"));
const { runChecklist } = await import(path.join(ENGINE_DIR, "redflags.js"));

// Every ParsedCoa field, defaulted to null - mirrors the Python dataclass's defaults so a
// redflags case's partial `coa` object in cases.json fills in the rest the same way
// `ParsedCoa(**case["coa"])` does on the Python side.
const PARSED_COA_DEFAULTS = {
  product_name: null, purity_pct: null, net_content_pct: null, mass_mg: null,
  batch_lot: null, test_date: null, method: null, lab_name: null,
};

function runParseCase(c) {
  const text = c.fixture
    ? readFileSync(path.join(FIXTURES_TEXT_DIR, c.fixture), "utf8")
    : c.text;

  const coa = parseCoa(text);
  const flags = runChecklist(coa);

  let purity = null;
  let purityError = null;
  if (coa.mass_mg === null) {
    purityError = "no mass/quantity (mg) found in the document";
  } else if (coa.purity_pct === null) {
    purityError = "no HPLC purity percentage found in the document";
  } else {
    try {
      purity = computePurity(coa.mass_mg, coa.purity_pct, coa.net_content_pct);
    } catch (err) {
      purityError = err.message;
    }
  }

  return { fields: coa, flags, purity, purity_error: purityError };
}

function runPurityCase(c) {
  return computePurity(c.labeled_mg, c.purity_pct, c.net_content_pct ?? null);
}

function runReconCase(c) {
  return computeRecon(c.vial_mg, c.water_ml, c.dose_mcg);
}

function runRedflagsCase(c) {
  const coa = { ...PARSED_COA_DEFAULTS, ...c.coa };
  return runChecklist(coa);
}

const RUNNERS = {
  parse: runParseCase,
  purity: runPurityCase,
  recon: runReconCase,
  redflags: runRedflagsCase,
};

function runCase(c) {
  const runner = RUNNERS[c.type];
  if (!runner) throw new Error(`unknown case type ${JSON.stringify(c.type)} in ${c.name}`);
  return runner(c);
}

// Deep compare; numbers within a tiny epsilon (should be near-EXACT since both sides do the
// same float arithmetic - this is a safety net for float ULP noise between V8 and CPython,
// not a tolerance for a wrong value), everything else strict equality. Object key order
// doesn't matter; array order does.
function diff(a, b, at = "$") {
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return null;
    return Math.abs(a - b) < 1e-9 ? null : `${at}: ${a} != ${b}`;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return `${at}: array vs non-array (js=${JSON.stringify(a)}, py=${JSON.stringify(b)})`;
    }
    if (a.length !== b.length) {
      return `${at}: length ${a.length} != ${b.length}\n  js=${JSON.stringify(a)}\n  py=${JSON.stringify(b)}`;
    }
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = diff(a[k], b[k], `${at}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${at}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
}

async function main() {
  if (!existsSync(FIXTURES_DIR)) {
    console.error(`no fixtures at ${FIXTURES_DIR} - run: python tests/web_parity/gen_fixtures.py`);
    process.exit(1);
  }

  const cases = JSON.parse(readFileSync(CASES_PATH, "utf8"));
  let pass = 0;
  let fail = 0;
  const failures = [];

  for (const c of cases) {
    const fixturePath = path.join(FIXTURES_DIR, `${c.name}.json`);
    if (!existsSync(fixturePath)) {
      fail++;
      console.log(`FAIL  ${c.name}`);
      console.log(`      no fixture at ${fixturePath} - run gen_fixtures.py first`);
      failures.push({ name: c.name, d: "missing fixture" });
      continue;
    }
    const py = JSON.parse(readFileSync(fixturePath, "utf8"));
    let js;
    let err = null;
    try {
      js = runCase(c);
    } catch (e) {
      err = e.stack || e.message;
    }
    const d = err ? `error: ${err}` : diff(js, py);
    if (d) {
      fail++;
      console.log(`FAIL  ${c.name}`);
      console.log(`      ${d}`);
      failures.push({ name: c.name, d, js, py });
    } else {
      pass++;
      console.log(`ok    ${c.name}  (${c.type})`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed  (${cases.length} cases)`);
  if (fail) {
    console.log("\n--- first failure detail ---");
    const f = failures[0];
    console.log("js:", JSON.stringify(f.js, null, 2));
    console.log("py:", JSON.stringify(f.py, null, 2));
    process.exit(1);
  }
}

main();
