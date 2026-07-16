// Unit tests for the region-drag -> screenshot-crop coordinate math. Pure arithmetic, no
// DOM/canvas needed - see extension/shared/crop-math.js's header for why that matters.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { computeCropRect } = await import(
  path.join(HERE, "..", "..", "extension", "shared", "crop-math.js")
);

test("dpr 1: CSS pixels map straight through", () => {
  const r = computeCropRect({
    rectCss: { left: 10, top: 20, width: 100, height: 50 },
    dpr: 1,
    imageWidth: 1200,
    imageHeight: 800,
  });
  assert.deepEqual(r, { sx: 10, sy: 20, sw: 100, sh: 50 });
});

test("dpr 2 (HiDPI): every dimension scales by the ratio", () => {
  const r = computeCropRect({
    rectCss: { left: 10, top: 20, width: 100, height: 50 },
    dpr: 2,
    imageWidth: 2400,
    imageHeight: 1600,
  });
  assert.deepEqual(r, { sx: 20, sy: 40, sw: 200, sh: 100 });
});

test("a selection dragged past the right/bottom edge clamps to the image bounds", () => {
  const r = computeCropRect({
    rectCss: { left: 190, top: 90, width: 50, height: 50 },
    dpr: 1,
    imageWidth: 200,
    imageHeight: 100,
  });
  assert.equal(r.sx, 190);
  assert.equal(r.sy, 90);
  assert.equal(r.sx + r.sw, 200); // never past the image's own width
  assert.equal(r.sy + r.sh, 100);
});

test("a negative origin (shouldn't happen, but don't hand back a negative crop) clamps to 0", () => {
  const r = computeCropRect({
    rectCss: { left: -5, top: -5, width: 40, height: 40 },
    dpr: 1,
    imageWidth: 200,
    imageHeight: 100,
  });
  assert.equal(r.sx, 0);
  assert.equal(r.sy, 0);
});

test("a missing/invalid dpr falls back to 1 rather than producing NaN", () => {
  const r = computeCropRect({
    rectCss: { left: 10, top: 10, width: 20, height: 20 },
    dpr: NaN,
    imageWidth: 200,
    imageHeight: 100,
  });
  assert.deepEqual(r, { sx: 10, sy: 10, sw: 20, sh: 20 });
});

test("crop size is never zero even for a degenerate 0-width/height rectangle", () => {
  const r = computeCropRect({
    rectCss: { left: 10, top: 10, width: 0, height: 0 },
    dpr: 1,
    imageWidth: 200,
    imageHeight: 100,
  });
  assert.ok(r.sw >= 1);
  assert.ok(r.sh >= 1);
});
