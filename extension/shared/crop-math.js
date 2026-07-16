// Pure coordinate math for turning a CSS-pixel drag rectangle into the source rectangle to
// crop out of a captured tab screenshot. No DOM/canvas here on purpose - kept as a pure
// function so it's unit-testable in plain Node (see tests/js/crop-math.test.mjs) without
// pulling in a canvas polyfill just to prove the arithmetic is right.
//
// `tabs.captureVisibleTab` returns a PNG at the tab's actual device-pixel resolution, while
// the region a user drags with the mouse is measured in CSS pixels (getBoundingClientRect,
// clientX/clientY). The two only line up after multiplying by devicePixelRatio - miss that
// on a HiDPI display and the crop lands up to 2-3x too small, into the wrong corner.

/**
 * @param {object} args
 * @param {{left: number, top: number, width: number, height: number}} args.rectCss - the
 *   dragged selection rectangle, in CSS pixels relative to the viewport.
 * @param {number} args.dpr - window.devicePixelRatio at capture time.
 * @param {number} args.imageWidth - width of the captured screenshot, in device pixels.
 * @param {number} args.imageHeight - height of the captured screenshot, in device pixels.
 * @returns {{sx: number, sy: number, sw: number, sh: number}} the crop rectangle in the
 *   screenshot's own pixel grid, clamped so it never runs past the image's edges.
 */
export function computeCropRect({ rectCss, dpr, imageWidth, imageHeight }) {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;

  const rawX = rectCss.left * ratio;
  const rawY = rectCss.top * ratio;
  const rawW = rectCss.width * ratio;
  const rawH = rectCss.height * ratio;

  const sx = Math.min(Math.max(0, Math.round(rawX)), Math.max(0, imageWidth - 1));
  const sy = Math.min(Math.max(0, Math.round(rawY)), Math.max(0, imageHeight - 1));

  // Clamp the far edge to the image bounds (a selection dragged to the very edge of the
  // viewport can round up past it by a pixel or two) rather than letting drawImage read
  // past the source image, which throws in some engines and silently pads in others.
  const farX = Math.min(imageWidth, Math.round(rawX + rawW));
  const farY = Math.min(imageHeight, Math.round(rawY + rawH));

  return {
    sx,
    sy,
    sw: Math.max(1, farX - sx),
    sh: Math.max(1, farY - sy),
  };
}
