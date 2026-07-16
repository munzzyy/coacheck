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
import { computePurity } from "./engine/purity.js";
import { computeRecon } from "./engine/recon.js";
import { runChecklist } from "./engine/redflags.js";
import { recognizeRegion } from "./ocr/recognize.js";

const OFFSCREEN_URL = "offscreen/offscreen.html";
const HAS_OFFSCREEN = typeof api.offscreen !== "undefined";

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

  return { coa, flags, purity, purityError };
}

async function triggerSelect(tab) {
  if (!tab || typeof tab.id !== "number") return;
  try {
    // Two files, one shared global scope (executeScript's files array behaves like
    // sequential classic <script> tags) - render-dom.js's helpers are what overlay.js
    // builds the results panel with.
    await api.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["shared/render-dom.js", "content/overlay.js"],
    });
  } catch {
    // Restricted page (chrome://, about:, an extension store) - nothing to inject into.
  }
}

api.action.onClicked.addListener((tab) => triggerSelect(tab));

api.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "select-region") return;
  if (!tab) {
    [tab] = await api.tabs.query({ active: true, currentWindow: true });
  }
  await triggerSelect(tab);
});

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object" || msg.target === "coacheck-offscreen") {
    return false; // not ours - e.g. addressed to the offscreen document instead
  }

  const run = async () => {
    switch (msg.cmd) {
      case "start-select": {
        const [tab] = await api.tabs.query({ active: true, currentWindow: true });
        await triggerSelect(tab);
        return { started: true };
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
