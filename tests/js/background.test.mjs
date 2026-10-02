// Tests for extension/background.js, imported for real over a stubbed extension API.
import assert from "node:assert/strict";
import test from "node:test";

const listeners = {};
const on = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
const state = { tabs: [], inject: null, injected: [], action: [] };
const record = (call) => async (details) => { state.action.push({ call, ...details }); };

globalThis.chrome = {
  runtime: { onMessage: on("message"), getURL: (p) => `chrome-extension://test/${p}` },
  commands: { onCommand: on("command") },
  tabs: { query: async () => state.tabs },
  scripting: {
    executeScript: async (details) => {
      state.injected.push(details);
      if (state.inject) throw state.inject;
    },
  },
  action: {
    setBadgeText: record("badge"),
    setBadgeBackgroundColor: record("color"),
    setTitle: record("title"),
  },
};
// The vendored Tesseract bundle that ocr/recognize.js imports reads `self` when it loads.
globalThis.self = globalThis;
await import("../../extension/background.js");

function reset({ tabs = [{ id: 7, windowId: 1 }], inject = null } = {}) {
  Object.assign(state, { tabs, inject, injected: [], action: [] });
}

const message = (msg) => new Promise((resolve) => listeners.message(msg, {}, resolve));
const RESTRICTED = new Error("Cannot access contents of the page.");

test("start-select injects the overlay into the active tab and says it started", async () => {
  reset();
  assert.deepEqual(await message({ cmd: "start-select" }), { ok: true, result: { started: true } });
  assert.deepEqual(state.injected, [
    { target: { tabId: 7 }, files: ["shared/render-dom.js", "content/overlay.js"] },
  ]);
});

test("start-select on a page extensions can't read says it did not start, and why", async () => {
  reset({ inject: RESTRICTED });
  assert.deepEqual(await message({ cmd: "start-select" }), {
    ok: true,
    result: { started: false, error: "Cannot access contents of the page." },
  });
  assert.deepEqual(state.action, [], "the popup explains it, so the toolbar button stays as is");
});

test("start-select with no active tab says it did not start", async () => {
  reset({ tabs: [] });
  const resp = await message({ cmd: "start-select" });
  assert.equal(resp.result.started, false);
  assert.equal(state.injected.length, 0);
});

test("the shortcut marks the toolbar button on a page it can't read", async () => {
  reset({ inject: RESTRICTED });
  await listeners.command("select-region", { id: 7 });
  const byCall = Object.fromEntries(state.action.map(({ call, ...rest }) => [call, rest]));
  assert.deepEqual(byCall.badge, { tabId: 7, text: "!" });
  assert.equal(byCall.color.tabId, 7);
  assert.equal(byCall.title.tabId, 7);
  assert.match(byCall.title.title, /can't read this page/);
});

test("the shortcut leaves the toolbar button alone when the overlay goes in", async () => {
  reset();
  await listeners.command("select-region", { id: 7 });
  assert.equal(state.injected.length, 1);
  assert.deepEqual(state.action, []);
});

test("the shortcut falls back to the active tab when the browser passes none", async () => {
  reset({ tabs: [{ id: 9 }], inject: RESTRICTED });
  await listeners.command("select-region", undefined);
  assert.equal(state.injected[0].target.tabId, 9);
  assert.ok(state.action.some((a) => a.call === "badge" && a.tabId === 9));
});
