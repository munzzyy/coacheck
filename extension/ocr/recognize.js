// Crops a captured screenshot down to the dragged region and OCRs it with a bundled,
// fully-local Tesseract.js worker - no CDN, no network permission, nothing leaves the
// machine. This module needs a real document (canvas, Image, Worker), so it only runs
// inside a genuine page context: Chrome's offscreen document, or Firefox's background
// event page (which, unlike Chrome's service worker, already has one - see background.js).
//
// vendor/tesseract/ and tessdata/ are vendored straight from the tesseract.js / tesseract.js-core
// / @tesseract.js-data npm packages (see extension/README.md for exact versions and why).
// Every path handed to createWorker below is an extension-local URL; nothing here has a
// remote fallback.

import Tesseract from "../vendor/tesseract/tesseract.esm.min.js";
import { computeCropRect } from "../shared/crop-math.js";
import { api } from "../shared/browser-api.js";

const { createWorker, OEM } = Tesseract;

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: api.runtime.getURL("vendor/tesseract/worker.min.js"),
      corePath: api.runtime.getURL("vendor/tesseract/tesseract-core-simd-lstm.wasm.js"),
      langPath: api.runtime.getURL("tessdata"),
      gzip: true,
      // The default spawns the worker through a blob: URL wrapping an importScripts() call,
      // which needs `blob:` in the extension's CSP worker-src/script-src. Pointing new
      // Worker() straight at our own chrome-extension:// URL instead satisfies the
      // extension_pages CSP's plain 'self' and skips that question entirely.
      workerBlobURL: false,
      logger: () => {},
    }).catch((err) => {
      // Don't cache a broken worker promise - the next call should get a fresh attempt
      // instead of forever replaying the same init failure.
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not decode the captured screenshot"));
    img.src = dataUrl;
  });
}

async function cropToDataUrl(dataUrl, rect, dpr) {
  const img = await loadImage(dataUrl);
  const { sx, sy, sw, sh } = computeCropRect({
    rectCss: rect,
    dpr,
    imageWidth: img.naturalWidth,
    imageHeight: img.naturalHeight,
  });
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL("image/png");
}

/**
 * Crop the region out of a captured screenshot and OCR it.
 *
 * @param {object} args
 * @param {string} args.dataUrl - the full-tab screenshot (tabs.captureVisibleTab PNG).
 * @param {{left: number, top: number, width: number, height: number}} args.rect - the
 *   dragged selection, in CSS pixels relative to the viewport.
 * @param {number} args.dpr - devicePixelRatio at capture time.
 * @returns {Promise<string>} the recognized text.
 */
export async function recognizeRegion({ dataUrl, rect, dpr }) {
  const cropped = await cropToDataUrl(dataUrl, rect, dpr);
  const worker = await getWorker();
  const { data } = await worker.recognize(cropped);
  return data.text;
}
