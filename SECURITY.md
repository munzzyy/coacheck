# Security

coacheck is a regex parser over plain text. You paste or pipe in the text of a
Certificate of Analysis; it extracts fields, runs a checklist, and does math.
Pure stdlib, no OCR, no PDF handling, no network, nothing executed. It also
handles no personal data - a COA describes a vial, not a person.

The realistic surface is small: input text crafted to hang the parser
(catastrophic regex backtracking) or to make the math lie - a document that
parses "successfully" into numbers that overstate what the checklist verified.
Since people use the output to sanity-check what's in a vial, a parsing bug
that inflates a purity number or silently skips a red-flag check matters more
here than a crash. Both kinds of report are welcome.

## Reporting a vulnerability

Please don't open a public issue for security problems. Use GitHub's private
reporting instead:

https://github.com/munzzyy/coacheck/security/advisories/new

Include what you found, how to reproduce it, and the impact you'd expect.

## Supported versions

Fixes land on the latest tagged version; there's no backport policy.
