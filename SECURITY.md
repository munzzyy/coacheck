# Security

coacheck is a regex parser over plain text. You paste or pipe in the text of a
Certificate of Analysis; it extracts fields, runs a checklist and does math.
The CLI is pure stdlib, with no OCR, no PDF handling, no network and nothing
executed. It also handles no personal data - a COA describes a vial, not a
person.

The browser extension in `extension/` is in scope too. When you click its
button it injects a drag-select overlay into the current tab, takes a
screenshot of the tab and OCRs the region you dragged with a bundled copy of
Tesseract.js. The results panel is drawn on the page in a closed shadow root.
It asks for `activeTab`, `scripting` and `offscreen` only. It makes no
network requests. Reports about the screenshot or the OCR text leaving the
machine, about the overlay or results panel running page-controlled markup,
or about the extension reaching a tab you didn't click it on all count.

The realistic surface is small: input text crafted to hang the parser
(catastrophic regex backtracking) or to make the math lie - a document that
parses "successfully" into numbers that overstate what the checklist verified.
People use the output to sanity-check what's in a vial. A parsing bug that
inflates a purity number or silently skips a red-flag check matters more here
than a crash. Both kinds of report are welcome.

## Reporting a vulnerability

Please don't open a public issue for security problems. Use GitHub's private
reporting instead:

https://github.com/munzzyy/coacheck/security/advisories/new

Include what you found, how to reproduce it, and the impact you'd expect.

## Supported versions

Fixes land on the latest tagged version; there's no backport policy.
