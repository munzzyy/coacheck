# coacheck browser extension

Drag a box over a Certificate of Analysis on any page - a vendor's product listing, a photo
of a vial's paperwork, anything on your screen - and get the same parsed fields, purity
math, reconstitution math, and red-flag checklist the `coacheck` CLI gives you, without
leaving the page. OCR runs entirely on your machine; nothing is uploaded anywhere.

One Manifest V3 codebase, loads in both Firefox and Chrome.

Informational tool only - not medical advice. It does not endorse, recommend, or source any
compound, and it can't tell you whether a document is genuine, only whether it's missing or
physically implausible data. See the root [README](../README.md) for what the underlying
checks do and don't do.

## Using it

1. Click the toolbar icon, or press **Alt+Shift+A**.
2. Drag a box over the COA. Esc cancels.
3. It captures that region, OCRs it locally, and shows the parsed fields, purity math, a
   reconstitution mini-calculator (enter water + dose to see the draw), and the red-flag
   checklist as an overlay on the page. Click the ✕ to dismiss it.

No COA handy, or OCR misreading a photo? Open the toolbar popup and paste the text in
directly - same engine, same output, no OCR involved.

## Loading it

### Firefox

Temporary (resets when Firefox restarts):

1. `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on** -> pick `extension/manifest.json`

Or with `web-ext`: `npx web-ext run --source-dir=extension`. Needs Firefox 140+ (this
extension's background script and the OCR worker inside it both need WebAssembly enabled by
CSP, which needs a recent-enough MV3 implementation - see Architecture below).

### Chrome

1. `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** -> pick the `extension/` folder

## Architecture

```
toolbar click / Alt+Shift+A
        |  chrome.scripting.executeScript
        v
content/overlay.js  (drag-select, pointer events - mouse and touch both)
        |  runtime.sendMessage({cmd: "process-region", rect, dpr})
        v
background.js  --tabs.captureVisibleTab-->  full-tab screenshot (PNG)
        |
        |-- Chrome: relay to a hidden offscreen document (chrome.offscreen) --
        |-- Firefox: run inline - its background page already has a DOM ------
        v
ocr/recognize.js:  crop to the dragged rect (canvas) -> Tesseract.js (bundled,
                   local wasm + language data, no network) -> recognized text
        v
engine/{parser,purity,recon,redflags}.js  (the JS port - see below)
        v
background.js sends the result back to content/overlay.js
        v
shared/render-dom.js builds the results panel -> textContent only, into a
                   closed shadow root on the page
```

Chrome's MV3 service worker has no `document`, so OCR (which needs a canvas and a real
`Worker`) runs in a Chrome-only offscreen document, created on demand and torn down by
Chrome itself. Firefox's MV3 background is an event page, not a service worker, and already
has a full DOM - it runs the same `ocr/recognize.js` module inline. Same code, two hosts;
`background.js` picks based on whether `chrome.offscreen` exists.

`background.js` is the only place that ever calls `tabs.captureVisibleTab` or talks to the
engine - `content/overlay.js` just draws the selection box and asks for a result.

## The JS engine port, and how it's kept honest

`extension/engine/` is a line-for-line port of `coacheck/parser.py`, `purity.py`, `recon.py`,
and `redflags.py`. A COA purity/pricing tool that silently disagrees between its CLI and its
extension is worse than no extension, so the port is pinned to the real Python engine by a
parity gate, not just "translated carefully and hoped":

- `tests/web_parity/gen_fixtures.py` runs the real `coacheck` package over every case in
  `cases.json` (all 8 fixtures in `tests/fixtures/`, plus edge cases mined from the Python
  test suite: comma decimals, purity over 100%, placeholder lab names, and so on) and writes
  each result to `fixtures/*.json` (gitignored, regenerated every run).
- `tests/web_parity/check.mjs` runs the exact same cases through `extension/engine/` in
  Node and deep-equals the two, floats compared within a tiny epsilon.
- If they disagree, the JS is wrong. Fix the JS to match Python, never the other way around.

```
python3 tests/web_parity/gen_fixtures.py
node tests/web_parity/check.mjs
```

Field names in the JS engine are snake_case (`purity_pct`, not `purityPct`) on purpose - it
mirrors the Python dataclasses' own JSON shape exactly, so the parity check is a plain deep
equal with no translation layer that could itself drift.

Unit tests for the engine and the crop-coordinate math live in `tests/js/` (`node --test
tests/js/*.test.mjs`, or `npm test`).

## OCR: bundled, local, no CDN

`vendor/tesseract/` and `tessdata/` ship the actual OCR engine and English language model,
vendored straight from the real `tesseract.js` / `tesseract.js-core` / `@tesseract.js-data`
npm packages (versions and licenses in `vendor/NOTICE.md`). Every path handed to
`createWorker()` in `ocr/recognize.js` is an extension-local URL - there is no CDN fallback,
and OCR makes zero network requests.

`tesseract-core-simd-lstm.wasm.js` is an Emscripten single-file build with the compiled
WebAssembly embedded as base64, so there's no separate `.wasm` file to serve alongside it.
LSTM-only + SIMD is fast and accurate; it needs WebAssembly SIMD, which every browser
version this extension targets already requires.

Pinned to tesseract.js 5.1.1 rather than tracking `@latest` - a long-stable line with
well-documented offline/self-hosted configuration, which is exactly the mode this runs in.

## Permissions, and why

| Permission | Why |
|---|---|
| `activeTab` | Lets a toolbar click or the keyboard shortcut capture a screenshot of the current tab, for that one tab and that one moment. Not a standing grant, no access between uses. |
| `scripting` | Injects the drag-select box and the results panel into the page you're on, only when you trigger it - never a persistent content script. |
| `offscreen` | Chrome only. A service worker has no document; this gives OCR a hidden page to run in. Firefox ignores this permission (its background page already has one) - that's the one `web-ext lint` warning that's expected, see below. |

No `host_permissions`, no `tabs`, no `storage`. This extension keeps no settings and
remembers nothing between uses - there's nothing to persist. `extension/about/about.html`
(linked from the popup) carries the same table for anyone who installs it and wants to
check before they read anything.

## Known, accepted `web-ext lint` warnings

`web-ext lint --source-dir=extension` passes clean (0 errors). It does report 7 warnings,
all expected:

- `MANIFEST_PERMISSIONS` on `offscreen` - a real Chrome MV3 permission the linter's Firefox-
  focused permission list doesn't know about yet. Firefox itself just ignores it.
- `BACKGROUND_SERVICE_WORKER_IGNORED` - by design. The manifest declares both
  `background.service_worker` (Chrome) and `background.scripts` (Firefox); each browser
  reads its own key and ignores the other, same pattern as this repo's other extensions.
- 5x `DANGEROUS_EVAL` / `UNSAFE_VAR_ASSIGNMENT` inside `vendor/tesseract/*.min.js` - from the
  unmodified, upstream Tesseract.js bundle's own minified/Emscripten-generated code, not
  anything written for this extension. Not something to "fix" by hand-editing a vendored
  third-party build.

## Honest limitations

- **OCR accuracy on real-world photos is genuinely rough.** Clean, high-contrast, screen-
  rendered text (a vendor's product page, a well-lit scan) OCRs close to perfectly. A blurry
  phone photo of a printed COA at an angle will not. When OCR doesn't find COA fields, the
  overlay says so plainly and shows the raw recognized text so you can see why, rather than
  guessing or failing silently.
- **Mobile Firefox is untested.** The drag-select uses Pointer Events (not mouse-only
  events) specifically so a single-finger drag works the same way a mouse drag does, and the
  manifest declares Android compatibility - but there's no Android device in this pass to
  confirm it against.
- **English only.** `tessdata/` ships the English language model only. Adding another
  language means vendoring its `.traineddata.gz` and passing the right `langPath`/`langs` -
  see `ocr/recognize.js`.
