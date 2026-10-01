// Tests for extension/content/overlay.js - the injected region-select + results overlay.
//
// overlay.js is a bare IIFE that talks to `document`, `window` and the extension API, so it
// runs here inside a node:vm context over a hand-rolled DOM stub. The stub implements only
// what overlay.js actually touches (createElement, append, remove, querySelectorAll by id,
// attachShadow, addEventListener) - enough to drive a full select -> results -> re-select
// cycle and see which host elements survive it. No jsdom, no dependencies, same as the rest
// of the repo.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY_SRC = readFileSync(
  path.join(HERE, "..", "..", "extension", "content", "overlay.js"),
  "utf8",
);
const HOST_ID = "coacheck-overlay-host";

function makeElement(tag) {
  const node = {
    tagName: tag,
    id: "",
    style: {},
    textContent: "",
    children: [],
    parent: null,
    listeners: new Map(),
    attributes: new Map(),
    focusCalls: 0,
    shadow: null,
    get isConnected() {
      let n = node;
      while (n.parent) n = n.parent;
      return n.tagName === "html";
    },
    setAttribute(name, value) {
      node.attributes.set(name, String(value));
    },
    focus() {
      node.focusCalls += 1;
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    addEventListener(type, fn) {
      if (!node.listeners.has(type)) node.listeners.set(type, []);
      node.listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = node.listeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatch(type, event) {
      for (const fn of [...(node.listeners.get(type) || [])]) fn(event);
    },
    append(...kids) {
      for (const kid of kids) {
        kid.parent = node;
        node.children.push(kid);
      }
    },
    replaceChildren(...kids) {
      node.children = [];
      node.append(...kids);
    },
    remove() {
      if (!node.parent) return;
      const i = node.parent.children.indexOf(node);
      if (i >= 0) node.parent.children.splice(i, 1);
      node.parent = null;
    },
    attachShadow() {
      const root = {
        host: node,
        children: [],
        append: (...kids) => root.children.push(...kids),
        replaceChildren: (...kids) => {
          root.children = [];
          root.children.push(...kids);
        },
      };
      node.shadow = root;
      return root;
    },
  };
  return node;
}

function makeDom() {
  const documentElement = makeElement("html");
  const walk = (node, out) => {
    for (const kid of node.children) {
      out.push(kid);
      walk(kid, out);
    }
    return out;
  };
  return {
    documentElement,
    createElement: makeElement,
    querySelectorAll(selector) {
      assert.ok(selector.startsWith("#"), `stub only supports id selectors, got ${selector}`);
      const id = selector.slice(1);
      return walk(documentElement, []).filter((n) => n.id === id);
    },
    getElementById(id) {
      return walk(documentElement, []).find((n) => n.id === id) ?? null;
    },
  };
}

function makeSandbox({ response = { ok: true, result: { coa: {}, flags: [] } } } = {}) {
  const document = makeDom();
  const windowListeners = new Map();
  const panels = [];
  const panel = (kind) => (_payload, opts) => {
    const node = makeElement("div");
    panels.push({ kind, node, opts });
    return node;
  };
  const sandbox = {
    document,
    devicePixelRatio: 1,
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = windowListeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    chrome: {
      runtime: {
        sendMessage: async () => response,
      },
    },
    CoacheckRender: {
      buildLoadingBadge: () => makeElement("div"),
      buildResultsPanel: panel("results"),
      buildErrorPanel: panel("error"),
    },
    setTimeout,
    clearTimeout,
    console,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext("globalThis.window = globalThis;", context);
  return {
    context,
    document,
    panels,
    hosts: () => document.querySelectorAll(`#${HOST_ID}`),
    listenerCount: (type) => (windowListeners.get(type) || []).length,
    fireWindow(type, event) {
      for (const fn of [...(windowListeners.get(type) || [])]) fn(event);
    },
    inject() {
      vm.runInContext(OVERLAY_SRC, context);
    },
  };
}

function pointerEvent(x, y) {
  return { button: 0, pointerType: "mouse", pointerId: 1, clientX: x, clientY: y, preventDefault() {} };
}

test("a second injection while a results panel is up leaves exactly one host", async () => {
  const env = makeSandbox();

  // First run: the crosshair veil goes up.
  env.inject();
  assert.equal(env.hosts().length, 1);

  // Drag a region. cleanup() drops the veil, processRegion mounts the results panel.
  const veil = env.hosts()[0].shadow.children[0];
  veil.dispatch("pointerdown", pointerEvent(10, 10));
  env.fireWindow("pointerup", pointerEvent(140, 120));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.hosts().length, 1, "the results panel is the only host now");

  // Click the toolbar button again with the panel still on screen. The panel and the new veil
  // share an id, so the old code appended a second host and stranded whichever one Escape
  // didn't happen to find first.
  env.inject();
  assert.equal(env.hosts().length, 1, "the new veil replaced the panel instead of stacking on it");

  // Escape has to leave the page clean, with no full-screen veil behind.
  env.fireWindow("keydown", { key: "Escape" });
  assert.equal(env.hosts().length, 0, "nothing is left covering the page");
});

test("cancelling a selection removes the veil", () => {
  const env = makeSandbox();
  env.inject();
  assert.equal(env.hosts().length, 1);
  env.fireWindow("keydown", { key: "Escape" });
  assert.equal(env.hosts().length, 0);
});

test("a sub-6px drag is treated as a stray click and clears the veil", async () => {
  const env = makeSandbox();
  env.inject();
  const veil = env.hosts()[0].shadow.children[0];
  veil.dispatch("pointerdown", pointerEvent(10, 10));
  env.fireWindow("pointerup", pointerEvent(12, 12));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.hosts().length, 0);
});

async function selectRegion(env) {
  const veil = env.hosts()[0].shadow.children[0];
  veil.dispatch("pointerdown", pointerEvent(10, 10));
  env.fireWindow("pointerup", pointerEvent(140, 120));
  await new Promise((resolve) => setImmediate(resolve));
}

test("the results panel takes focus when it opens", async () => {
  const env = makeSandbox();
  env.inject();
  await selectRegion(env);
  assert.equal(env.panels.length, 1);
  assert.equal(env.panels[0].kind, "results");
  assert.equal(env.panels[0].node.focusCalls, 1);
});

test("the error panel takes focus when it opens", async () => {
  const env = makeSandbox({ response: { ok: false, error: "capture failed" } });
  env.inject();
  await selectRegion(env);
  assert.equal(env.panels.length, 1);
  assert.equal(env.panels[0].kind, "error");
  assert.equal(env.panels[0].node.focusCalls, 1);
});

test("Escape closes the results panel and drops its key listener", async () => {
  const env = makeSandbox();
  env.inject();
  await selectRegion(env);
  assert.equal(env.hosts().length, 1);
  env.fireWindow("keydown", { key: "Tab" });
  assert.equal(env.hosts().length, 1, "only Escape closes it");
  env.fireWindow("keydown", { key: "Escape" });
  assert.equal(env.hosts().length, 0);
  assert.equal(env.listenerCount("keydown"), 0);
});

test("the close button drops the Escape listener too", async () => {
  const env = makeSandbox();
  env.inject();
  await selectRegion(env);
  env.panels[0].opts.onClose();
  assert.equal(env.hosts().length, 0);
  assert.equal(env.listenerCount("keydown"), 0);
});

test("a panel replaced by a new selection lets go of its key listener", async () => {
  const env = makeSandbox();
  env.inject();
  await selectRegion(env);
  env.inject();
  await selectRegion(env);
  assert.equal(env.hosts().length, 1);
  env.fireWindow("keydown", { key: "a" });
  assert.equal(env.listenerCount("keydown"), 1, "only the live panel still listens");
  env.fireWindow("keydown", { key: "Escape" });
  assert.equal(env.hosts().length, 0);
  assert.equal(env.listenerCount("keydown"), 0);
});
