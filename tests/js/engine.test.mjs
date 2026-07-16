// Unit tests for the extension's JS engine port (extension/engine/). These check the
// module's own behavior in isolation (error handling, edge cases); tests/web_parity/ is
// what proves its output matches the real Python engine exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.join(HERE, "..", "..", "extension", "engine");

const { parseCoa, MAX_COA_TEXT_CHARS } = await import(path.join(ENGINE_DIR, "parser.js"));
const { computePurity } = await import(path.join(ENGINE_DIR, "purity.js"));
const { computeRecon } = await import(path.join(ENGINE_DIR, "recon.js"));
const { runChecklist, RESEARCH_GRADE_PURITY_THRESHOLD, Status } = await import(
  path.join(ENGINE_DIR, "redflags.js")
);

test("parseCoa: all fields null on empty text", () => {
  const coa = parseCoa("");
  for (const value of Object.values(coa)) assert.equal(value, null);
});

test("parseCoa: non-string input throws TypeError", () => {
  assert.throws(() => parseCoa(42), TypeError);
});

test("parseCoa: oversized input throws RangeError", () => {
  const huge = "x".repeat(MAX_COA_TEXT_CHARS + 1);
  assert.throws(() => parseCoa(huge), RangeError);
});

test("parseCoa: text at the exact size cap is accepted", () => {
  const text = `Purity: 99%\n${"x".repeat(MAX_COA_TEXT_CHARS - 12)}`;
  assert.doesNotThrow(() => parseCoa(text));
});

test("parseCoa: case-insensitive label", () => {
  assert.equal(parseCoa("purity: 95%\n").purity_pct, 95.0);
});

test("parseCoa: comma decimal separator normalizes to a dot", () => {
  assert.equal(parseCoa("Purity: 98,99%\n").purity_pct, 98.99);
});

test("computePurity: purity only, no net content", () => {
  const r = computePurity(5.0, 98.0);
  assert.ok(Math.abs(r.actual_mg - 4.9) < 1e-9);
  assert.ok(Math.abs(r.shortfall_mg - 0.1) < 1e-9);
  assert.equal(r.net_content_pct, null);
});

test("computePurity: purity and net content combine multiplicatively", () => {
  const r = computePurity(5.0, 99.0, 92.0);
  assert.ok(Math.abs(r.actual_mg - 4.554) < 1e-9);
});

test("computePurity: zero labeled_mg throws", () => {
  assert.throws(() => computePurity(0.0, 98.0), RangeError);
});

test("computePurity: negative purity throws", () => {
  assert.throws(() => computePurity(5.0, -1.0), RangeError);
});

test("computePurity: NaN labeled_mg throws", () => {
  assert.throws(() => computePurity(NaN, 98.0), RangeError);
});

test("computePurity: infinite purity throws", () => {
  assert.throws(() => computePurity(5.0, Infinity), RangeError);
});

test("computePurity: purity over 100 computes through rather than rejecting", () => {
  const r = computePurity(5.0, 150.0);
  assert.ok(Math.abs(r.actual_mg - 7.5) < 1e-9);
  assert.ok(Math.abs(r.shortfall_pct - -50.0) < 1e-9);
});

test("computeRecon: basic draw", () => {
  const r = computeRecon(5.0, 2.0, 250.0);
  assert.ok(Math.abs(r.concentration_mcg_per_ml - 2500.0) < 1e-9);
  assert.ok(Math.abs(r.units_per_dose - 10.0) < 1e-9);
  assert.equal(r.exceeds_vial, false);
});

test("computeRecon: dose larger than vial sets exceeds_vial", () => {
  const r = computeRecon(1.0, 1.0, 2000.0);
  assert.equal(r.exceeds_vial, true);
  assert.ok(r.doses_per_vial < 1.0);
});

test("computeRecon: zero water throws", () => {
  assert.throws(() => computeRecon(5.0, 0.0, 250.0), RangeError);
});

test("computeRecon: negative dose throws", () => {
  assert.throws(() => computeRecon(5.0, 2.0, -250.0), RangeError);
});

const PARSED_COA_DEFAULTS = {
  product_name: null, purity_pct: null, net_content_pct: null, mass_mg: null,
  batch_lot: null, test_date: null, method: null, lab_name: null,
};

function coaWith(overrides) {
  return { ...PARSED_COA_DEFAULTS, ...overrides };
}

test("runChecklist: returns the 7 stable ids in order", () => {
  const flags = runChecklist(coaWith({}));
  assert.deepEqual(
    flags.map((f) => f.id),
    ["CC-PURITY", "CC-BATCH", "CC-LAB", "CC-METHOD", "CC-DATE", "CC-PURITY-METHOD", "CC-NET"],
  );
});

test("runChecklist: missing purity is a fail", () => {
  const flags = runChecklist(coaWith({ purity_pct: null }));
  assert.equal(flags.find((f) => f.id === "CC-PURITY").status, Status.FAIL);
});

test("runChecklist: purity at the research-grade threshold passes", () => {
  const flags = runChecklist(coaWith({ purity_pct: RESEARCH_GRADE_PURITY_THRESHOLD }));
  assert.equal(flags.find((f) => f.id === "CC-PURITY").status, Status.PASS);
});

test("runChecklist: purity just below the threshold warns", () => {
  const flags = runChecklist(coaWith({ purity_pct: RESEARCH_GRADE_PURITY_THRESHOLD - 0.1 }));
  assert.equal(flags.find((f) => f.id === "CC-PURITY").status, Status.WARN);
});

test("runChecklist: placeholder lab values warn, not pass", () => {
  for (const placeholder of ["N/A", "In-house", "internal", "Undisclosed"]) {
    const flags = runChecklist(coaWith({ lab_name: placeholder }));
    assert.equal(flags.find((f) => f.id === "CC-LAB").status, Status.WARN, placeholder);
  }
});

test("runChecklist: a missing purity claim makes CC-PURITY-METHOD pass, not warn", () => {
  const flags = runChecklist(coaWith({ purity_pct: null, method: null }));
  assert.equal(flags.find((f) => f.id === "CC-PURITY-METHOD").status, Status.PASS);
});

test("runChecklist: net content over 100 fails", () => {
  const flags = runChecklist(coaWith({ net_content_pct: 104.0 }));
  assert.equal(flags.find((f) => f.id === "CC-NET").status, Status.FAIL);
});
