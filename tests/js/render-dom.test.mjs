// Tests for extension/shared/render-dom.js.
//
// It's a classic script that hangs its exports off `window`, so it gets loaded into a
// node:vm context the same way overlay.test.mjs loads the content script, over a DOM stub
// that records tag names, attributes and listeners so the panels can be inspected.
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

function makeElement(tag) {
  const node = {
    tagName: tag,
    attributes: new Map(),
    listeners: new Map(),
    style: {},
    children: [],
    textContent: "",
    setAttribute(name, value) {
      node.attributes.set(name, String(value));
    },
    getAttribute(name) {
      return node.attributes.has(name) ? node.attributes.get(name) : null;
    },
    addEventListener(type, fn) {
      if (!node.listeners.has(type)) node.listeners.set(type, []);
      node.listeners.get(type).push(fn);
    },
    dispatch(type, event = {}) {
      for (const fn of node.listeners.get(type) || []) fn(event);
    },
    append(...kids) {
      node.children.push(...kids);
    },
  };
  return node;
}

const document = {
  createElement: makeElement,
  createTextNode: (text) => ({ tagName: "#text", textContent: text, children: [] }),
};

const context = vm.createContext({ console, document });
vm.runInContext("globalThis.window = globalThis;", context);
vm.runInContext(SRC, context);
const {
  reconVialMg, fieldText, buildResultsPanel, buildErrorPanel, buildLoadingBadge,
} = context.CoacheckRender;

function descendants(node, out = []) {
  for (const kid of node.children) {
    out.push(kid);
    descendants(kid, out);
  }
  return out;
}

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

const PAYLOAD = {
  coa: { product_name: "RC-118", purity_pct: 99.1, mass_mg: 5.0 },
  flags: [{ id: "CC-PURITY", status: "pass", title: "Purity", detail: "99.1%" }],
  purity: PURITY,
  purityError: null,
  ocrText: "Purity: 99.1%",
};

function closeButtons(panel) {
  return descendants(panel).filter((n) => n.textContent === "\u2715");
}

test("both panels close through a real, labeled button", () => {
  for (const build of [
    (opts) => buildResultsPanel(PAYLOAD, opts),
    (opts) => buildErrorPanel("capture failed", opts),
  ]) {
    let closed = 0;
    const [button, ...rest] = closeButtons(build({ onClose: () => { closed += 1; } }));
    assert.equal(rest.length, 0);
    assert.equal(button.tagName, "button");
    assert.equal(button.getAttribute("type"), "button");
    assert.equal(button.getAttribute("aria-label"), "Close");
    button.dispatch("click");
    assert.equal(closed, 1);
  }
});

test("every reconstitution control has an accessible name", () => {
  const controls = descendants(buildResultsPanel(PAYLOAD))
    .filter((n) => n.tagName === "input" || n.tagName === "select");
  assert.deepEqual(
    controls.map((n) => n.getAttribute("aria-label")),
    ["water (mL)", "dose", "dose unit", "mass to compute from"],
  );
});

test("the results panel is a labeled, focusable region", () => {
  const panel = buildResultsPanel(PAYLOAD);
  assert.equal(panel.getAttribute("role"), "region");
  assert.equal(panel.getAttribute("aria-label"), "coacheck results");
  assert.equal(panel.getAttribute("tabindex"), "-1");
});

test("the error panel is announced as an alert and can take focus", () => {
  const panel = buildErrorPanel("capture failed");
  assert.equal(panel.getAttribute("role"), "alert");
  assert.equal(panel.getAttribute("tabindex"), "-1");
});

test("the reconstitution output is a polite live region", () => {
  const live = descendants(buildResultsPanel(PAYLOAD)).filter((n) => n.getAttribute?.("aria-live"));
  assert.equal(live.length, 1);
  assert.equal(live[0].getAttribute("aria-live"), "polite");
});

test("the loading badge is a status message", () => {
  assert.equal(buildLoadingBadge().getAttribute("role"), "status");
});
