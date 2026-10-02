// coacheck background - owns tab capture, OCR orchestration, and every call into the
// engine. Runs as a real ES module in both browsers: a service worker in Chrome
// (background.service_worker + type: module) and an event page in Firefox
// (background.scripts + type: module) - the manifest declares both keys, each browser
// reads its own and ignores the other.
//
// Chrome's service worker has no document, so OCR (which needs a canvas and a Worker)
// runs in a separate offscreen document, created on demand. Firefox's event page already
// has a full DOM, so it runs OCR inline instead - see ocr/recognize.js.

import { api } from "./shared/browser-api.js";
import { parseCoa } from "./engine/parser.js";
import { purityFromCoa } from "./engine/purity.js";
import { computeRecon } from "./engine/recon.js";
import { runChecklist } from "./engine/redflags.js";
import { recognizeRegion } from "./ocr/recognize.js";

const OFFSCREEN_URL = "offscreen/offscreen.html";
const HAS_OFFSCREEN = typeof api.offscreen !== "undefined";
// The shortcut has no popup to explain a failure in, so the toolbar button carries it.
const UNREADABLE_TITLE = "coacheck can't read this page. Click here and paste the COA text instead.";

async function ensureOffscreenDocument() {
  if (await api.offscreen.hasDocument()) return;
  await api.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["WORKERS"],
    justification:
      "Runs the bundled Tesseract.js OCR worker; a service worker can't host the "
      + "document/Worker context OCR needs.",
  });
}

async function recognizeInOffscreen(payload) {
  await ensureOffscreenDocument();
  const resp = await api.runtime.sendMessage({
    target: "coacheck-offscreen",
    cmd: "recognize",
    ...payload,
  });
  if (!resp || !resp.ok) throw new Error(resp?.error || "offscreen OCR failed");
  return resp.text;
}

function getOcrText(payload) {
  return HAS_OFFSCREEN ? recognizeInOffscreen(payload) : recognizeRegion(payload);
}

// Same shape cli.py's cmd_parse builds: fields + red-flag flags + purity math (or, if the
// document doesn't carry what purity math needs, a plain-English reason why not).
function buildParseResult(coaText) {
  const coa = parseCoa(coaText);
  const flags = runChecklist(coa);
  const [purity, purityError] = purityFromCoa(coa);
  return { coa, flags, purity, purityError };
}

async function triggerSelect(tab) {
  if (!tab || typeof tab.id !== "number") return { started: false, error: "no active tab" };
  try {
    // Two files, one shared global scope (executeScript's files array behaves like
    // sequential classic <script> tags) - render-dom.js's helpers are what overlay.js
    // builds the results panel with.
    await api.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["shared/render-dom.js", "content/overlay.js"],
    });
    return { started: true };
  } catch (err) {
    // Restricted page (chrome://, about:, an extension store, another extension's page).
    return { started: false, error: String(err?.message || err) };
  }
}

// Both browsers drop a tab's own badge and title when it navigates, so this clears itself.
function markUnreadable(tabId) {
  return Promise.all([
    api.action.setBadgeText({ tabId, text: "!" }),
    api.action.setBadgeBackgroundColor({ tabId, color: "#e06c75" }),
    api.action.setTitle({ tabId, title: UNREADABLE_TITLE }),
  ]);
}

api.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "select-region") return;
  if (!tab) {
    [tab] = await api.tabs.query({ active: true, currentWindow: true });
  }
  const { started } = await triggerSelect(tab);
  if (!started && typeof tab?.id === "number") await markUnreadable(tab.id);
});

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object" || msg.target === "coacheck-offscreen") {
    return false; // not ours - e.g. addressed to the offscreen document instead
  }

  const run = async () => {
    switch (msg.cmd) {
      case "start-select": {
        const [tab] = await api.tabs.query({ active: true, currentWindow: true });
        return triggerSelect(tab);
      }

      case "process-region": {
        const tab = sender.tab;
        if (!tab) throw new Error("no source tab for this capture");
        const dataUrl = await api.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        const text = await getOcrText({ dataUrl, rect: msg.rect, dpr: msg.dpr || 1 });
        return { ...buildParseResult(text), ocrText: text };
      }

      case "parse-text":
        return { ...buildParseResult(String(msg.text ?? "")), ocrText: null };

      case "recon":
        return computeRecon(msg.vialMg, msg.waterMl, msg.doseMcg);

      default:
        throw new Error(`unknown command: ${msg.cmd}`);
    }
  };

  run().then(
    (result) => sendResponse({ ok: true, result }),
    (err) => sendResponse({ ok: false, error: String(err?.message || err) }),
  );
  return true;
});
