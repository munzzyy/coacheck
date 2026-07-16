# Vendored OCR components

Everything under `vendor/tesseract/` and `tessdata/` ships from the real npm packages
below, unmodified, so OCR runs fully offline with no CDN and no network permission. See
`extension/README.md` for how they're wired in and why.

| File | From | Version | License |
|---|---|---|---|
| `vendor/tesseract/tesseract.esm.min.js` | `tesseract.js` | 5.1.1 | Apache-2.0 (`LICENSE-tesseract.js.md`) |
| `vendor/tesseract/worker.min.js` | `tesseract.js` | 5.1.1 | Apache-2.0, bundles MIT/BSD-3-Clause deps (`worker.min.js.LICENSE.txt`) |
| `vendor/tesseract/tesseract-core-simd-lstm.wasm.js` | `tesseract.js-core` | 5.1.1 | Apache-2.0 (`LICENSE-tesseract.js-core.txt`) |
| `tessdata/eng.traineddata.gz` | `@tesseract.js-data/eng` (the `4.0.0_best_int` variant) | 1.0.0 | MIT |

`tesseract-core-simd-lstm.wasm.js` is an Emscripten single-file build - the compiled
WebAssembly is embedded in it as base64, so there's no separate `.wasm` to fetch or vendor
alongside it. LSTM-only (`OEM.LSTM_ONLY`) + SIMD is the modern, fast, accurate combination;
it needs WebAssembly SIMD, which every browser version this extension targets already
requires for other reasons (see the manifest's `strict_min_version`).

Pinned to 5.1.1 deliberately rather than tracking `tesseract.js@latest` - it's a
long-stable line with well-documented offline/self-hosted configuration (`corePath`,
`workerPath`, `langPath`), which is exactly the mode this extension runs it in.
