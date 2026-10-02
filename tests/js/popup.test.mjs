// Tests for extension/popup/popup.js, run in a node:vm context over a DOM stub of its five ids.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "extension", "popup", "popup.js"),
  "utf8",
);

function makeElement(id) {
  const listeners = new Map();
  return {
    id,
    value: "",
    textContent: "",
    disabled: false,
    focusCalls: 0,
    focus() { this.focusCalls += 1; },
    replaceChildren() {},
    addEventListener(type, fn) { listeners.set(type, fn); },
    fire(type) { return listeners.get(type)(); },
  };
}

function loadPopup(response) {
  const els = Object.fromEntries(["select", "analyze", "text", "result", "err"].map((id) => [id, makeElement(id)]));
  const sent = [];
  let closed = 0;
  const context = vm.createContext({
    document: { getElementById: (id) => els[id] ?? null },
    chrome: { runtime: { sendMessage: async (msg) => { sent.push(msg); return response; } } },
    close: () => { closed += 1; },
  });
  vm.runInContext("globalThis.window = globalThis;", context);
  vm.runInContext(SRC, context);
  return { els, sent, closed: () => closed };
}

test("the select button closes the popup once the overlay is on the page", async () => {
  const popup = loadPopup({ ok: true, result: { started: true } });
  await popup.els.select.fire("click");
  assert.deepEqual(popup.sent.map((m) => m.cmd), ["start-select"]);
  assert.equal(popup.closed(), 1);
  assert.equal(popup.els.err.textContent, "");
});

test("on a page extensions can't read, the popup stays open and points at the paste box", async () => {
  const popup = loadPopup({ ok: true, result: { started: false, error: "Cannot access contents of the page." } });
  await popup.els.select.fire("click");
  assert.equal(popup.closed(), 0);
  assert.match(popup.els.err.textContent, /can't read this page/);
  assert.match(popup.els.err.textContent, /[Pp]aste the COA text below/);
  assert.equal(popup.els.text.focusCalls, 1);
});

test("a background error shows in the popup instead of closing it", async () => {
  const popup = loadPopup({ ok: false, error: "unknown command: start-select" });
  await popup.els.select.fire("click");
  assert.equal(popup.closed(), 0);
  assert.equal(popup.els.err.textContent, "unknown command: start-select");
});
