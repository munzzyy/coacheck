// Chrome-only OCR host. background.js creates this offscreen document on demand and talks
// to it over the ordinary runtime messaging bus (offscreen documents share it with every
// other extension context) - the `target` field is how this listener tells its own traffic
// apart from messages meant for background.js.

import { api } from "../shared/browser-api.js";
import { recognizeRegion } from "../ocr/recognize.js";

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== "coacheck-offscreen" || msg.cmd !== "recognize") {
    return false;
  }
  recognizeRegion({ dataUrl: msg.dataUrl, rect: msg.rect, dpr: msg.dpr })
    .then((text) => sendResponse({ ok: true, text }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});
