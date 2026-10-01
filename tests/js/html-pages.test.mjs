// The extension's HTML pages are static, so their accessibility markup is checked as text.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "extension");
const page = (rel) => readFileSync(path.join(EXT, rel), "utf8");

test("every extension page declares its language", () => {
  for (const rel of ["popup/popup.html", "about/about.html", "offscreen/offscreen.html"]) {
    assert.match(page(rel), /<html lang="en">/, rel);
  }
});

test("the popup's paste box has a label", () => {
  const html = page("popup/popup.html");
  assert.match(html, /<textarea id="text"/);
  assert.match(html, /<label [^>]*for="text"[^>]*>[^<]+<\/label>/);
});

test("popup errors are announced", () => {
  assert.match(page("popup/popup.html"), /<div id="err" role="alert">/);
});
