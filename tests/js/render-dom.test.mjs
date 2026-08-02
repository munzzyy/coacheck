// Tests for extension/shared/render-dom.js.
//
// It's a classic script that hangs its exports off `window`, so it gets loaded into a
// node:vm context the same way overlay.test.mjs loads the content script. Only the parts
// that don't need a live DOM are exercised here: fieldText's formatting, and reconVialMg,
// which decides which mass the reconstitution calculator runs on.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  path.join(HERE, "..", "..", "extension", "shared", "render-dom.js"),
  "utf8",
);

const context = vm.createContext({ console });
vm.runInContext("globalThis.window = globalThis;", context);
vm.runInContext(SRC, context);
const { reconVialMg, fieldText } = context.CoacheckRender;

const COA = { mass_mg: 5.0 };
const PURITY = { labeled_mg: 5.0, actual_mg: 4.533825, shortfall_mg: 0.466175, shortfall_pct: 9.3235 };

test("the deliverable mass is the default basis, not the labeled mass", () => {
  assert.equal(reconVialMg(COA, PURITY, "actual"), 4.533825);
});

test("the labeled basis uses the mass printed on the label", () => {
  assert.equal(reconVialMg(COA, PURITY, "labeled"), 5.0);
});

test("with no purity result there is nothing but the labeled mass to use", () => {
  assert.equal(reconVialMg(COA, null, "actual"), 5.0);
  assert.equal(reconVialMg(COA, undefined, "actual"), 5.0);
});

test("a non-finite deliverable mass falls back to the label", () => {
  assert.equal(reconVialMg(COA, { actual_mg: NaN }, "actual"), 5.0);
});

test("no mass at all comes back as null rather than undefined", () => {
  assert.equal(reconVialMg({ mass_mg: null }, null, "actual"), null);
  assert.equal(reconVialMg({}, null, "actual"), null);
});

test("fieldText renders a missing field, a qualifier and a mass", () => {
  assert.equal(fieldText({ purity_pct: null }, "purity_pct"), "(not found)");
  assert.equal(fieldText({ purity_pct: 98, purity_qualifier: ">=" }, "purity_pct"), ">=98%");
  assert.equal(fieldText({ mass_mg: 5 }, "mass_mg"), "5 mg");
});
