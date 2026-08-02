// Regex-based field extraction from a Certificate of Analysis (COA) text blob.
//
// This is a line-for-line JS port of coacheck/parser.py, kept in exact sync with it -
// see tests/web_parity/ for the check that proves it. Field names are left snake_case
// (purity_pct, not purityPct) on purpose: the parity checker deep-equals this module's
// output against the real Python engine's JSON, and matching key names removes an entire
// class of translation bugs a camelCase mapping layer would invite.
//
// A COA is a lab report that comes with a peptide vial: a product name, an HPLC purity
// percentage, sometimes a separate net peptide content percentage, a mass/quantity, a
// batch or lot number, a test date, a test method, and the name of the lab that ran the
// test. Real-world COAs word these labels a dozen different ways ("Purity", "HPLC Purity",
// "Purity (HPLC)", "Purity (%)"), so every field is matched against a list of label
// variants, tried top to bottom, first match in the document wins.
//
// This module only extracts text. It does not judge, normalize dates, or resolve unit
// ambiguity beyond what's written - see purity.js and redflags.js for the arithmetic and
// the checklist built on top of it.

// A COA is a short document. This cap is generous headroom over any real one and exists
// only to stop pathological input (e.g. OCR runaway output) from making the regex scan slow.
export const MAX_COA_TEXT_CHARS = 100_000;

// What separates a label from its value. A colon or an equals sign always does. A dash only
// counts when whitespace comes before it, because label names carry their own hyphens
// ("Lot-Nr", "Batch-No", "Lab-tested") and splitting on a bare dash reads the tail of the
// label as the value - non-empty garbage that then passes the checklist. The lookbehind is
// zero-width so the label pattern's own \s* stays the only whitespace run in front of the
// separator; two adjacent \s* runs are what makes the scan quadratic on a long run of spaces.
//
// Built from code points, not literals, so this source file stays plain ASCII: OCR of a
// printed COA turns plenty of hyphens into a long dash, so those count as separators too.
const LONG_DASHES = String.fromCharCode(0x2013, 0x2014);
const SEP = `(?::|=|(?<=\\s)[-${LONG_DASHES}])\\s*`;

// The same characters, for the column-gap test in segments() below.
const SEP_CHARS = `:=-${LONG_DASHES}`;

// Optional qualifier some COAs put in front of a percentage ("Purity: >=98%"). Captured so
// the checklist can tell a confirmed value from a bound: "<98%" is an upper bound, not a
// claim that purity is 98%. Pharma COAs write the same bounds as words at least as often as
// symbols ("NLT 98.0%", "min. 98.0%"), so those are matched too and normalized to the symbol
// they mean.
const QUALIFIER =
  "(?:(>=|<=|~|>|<|≥|≤"
  + "|not\\s+less\\s+than|not\\s+more\\s+than|greater\\s+than|less\\s+than"
  + "|nlt|nmt|min(?:imum)?\\.?|max(?:imum)?\\.?)\\s*)?";

const QUALIFIER_WORDS = {
  "nlt": ">=", "not less than": ">=", "min": ">=", "min.": ">=",
  "minimum": ">=", "minimum.": ">=",
  "nmt": "<=", "not more than": "<=", "max": "<=", "max.": "<=",
  "maximum": "<=", "maximum.": "<=",
  "greater than": ">", "less than": "<",
};

const WHITESPACE_RUN = /\s+/g;

// A decimal number, accepting either a dot or a comma as the separator - COAs from outside
// the US/UK commonly write "98,99%" rather than "98.99%". \d is ASCII here, which the Python
// port matches ([0-9]) so non-ASCII digits behave the same in both. toFloat sorts out
// comma-as-decimal vs comma-as-thousands-separator.
const DECIMAL_VALUE = "(\\d+(?:[.,]\\d+)?)";
const PCT_VALUE = `${QUALIFIER}${DECIMAL_VALUE}\\s*%?`;

// A number written with commas as thousands separators ("1,000", "5,000"). Told apart from a
// comma decimal ("98,99") so "1,000 mg" isn't read as 1 mg.
const THOUSANDS_GROUPED = /^\d{1,3}(?:,\d{3})+$/;

// Vials get labeled in more than mg. Everything is normalized to mg so the purity and
// reconstitution math downstream only ever sees one unit. "mcg" has to be tried before "g"
// or the alternation matches the tail of it.
const MICRO = String.fromCharCode(0x00b5);
const MU = String.fromCharCode(0x03bc);
const MASS_UNIT = `\\s*(mcg|${MICRO}g|${MU}g|ug|mg|g)\\b`;

const MASS_UNIT_TO_MG = {
  mg: 1.0,
  mcg: 0.001,
  [`${MICRO}g`]: 0.001,
  [`${MU}g`]: 0.001,
  ug: 0.001,
  g: 1000.0,
};

// Whitespace wide enough to read as a column gap in a table-shaped COA. A single space is not
// one: "Sample Peptide SP-200" is one value, not three.
const COLUMN_GAP = /\t+|[ \t]{2,}/g;

// A COA line holds a handful of columns. Past this it isn't a table, it's a wall of text, and
// running every label pattern over every piece of it would cost more than it could ever find.
export const MAX_LINE_SEGMENTS = 32;

// Python's str.splitlines() breaks on more than \r\n/\r/\n - vertical tab, form feed, the
// file/group/record separators, NEL, and the Unicode line/paragraph separators too. Match
// that set so the same bytes split into the same lines in both engines.
const LINE_SPLIT = /\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/;

const PRODUCT_PATTERNS = [
  new RegExp(`^product\\s*name\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^product\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^peptide\\s*name\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^compound\\s*name\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^item\\s*name\\s*${SEP}(.+)$`, "i"),
];

// The trailing whitespace is pulled inside the optional group ("(?:\(...\)\s*)?" rather than
// "(?:\(...\))?\s*") so there are never two free-floating \s* runs on either side of an
// empty-matchable group - that adjacency is what makes the scan quadratic on a long run of
// whitespace.
const PURITY_PATTERNS = [
  new RegExp(`^(?:hplc\\s+)?purity\\s*(?:\\([^)]*\\)\\s*)?${SEP}${PCT_VALUE}`, "i"),
];

const NET_CONTENT_PATTERNS = [
  new RegExp(`^net\\s*peptide\\s*content\\s*(?:\\([^)]*\\)\\s*)?${SEP}${PCT_VALUE}`, "i"),
  new RegExp(`^net\\s*content\\s*(?:\\([^)]*\\)\\s*)?${SEP}${PCT_VALUE}`, "i"),
  new RegExp(`^peptide\\s*content\\s*(?:\\([^)]*\\)\\s*)?${SEP}${PCT_VALUE}`, "i"),
];

const MASS_PATTERNS = [
  new RegExp(`^net\\s*weight\\s*${SEP}${DECIMAL_VALUE}${MASS_UNIT}`, "i"),
  new RegExp(`^quantity\\s*${SEP}${DECIMAL_VALUE}${MASS_UNIT}`, "i"),
  new RegExp(`^vial\\s*(?:content|weight|size)\\s*${SEP}${DECIMAL_VALUE}${MASS_UNIT}`, "i"),
  new RegExp(`^fill\\s*weight\\s*${SEP}${DECIMAL_VALUE}${MASS_UNIT}`, "i"),
  new RegExp(`^(?:mass|weight)\\s*${SEP}${DECIMAL_VALUE}${MASS_UNIT}`, "i"),
];

// "(?:\s*-)?" rather than "\s*-?" for the hyphenated spellings ("Batch-No"): an optional
// single character between two \s* runs is the quadratic shape again.
const BATCH_LABEL_TAIL = "(?:\\s*-)?\\s*(?:(?:no\\.?|nr\\.?|number)\\s*)?";

// A batch number can carry internal spaces ("RC 118 A"). The old \S+ capture cut it off at the
// first one; the value now runs to the end of the segment, and segments() has already cut the
// segment off at the next column.
const BATCH_PATTERNS = [
  new RegExp(`^batch\\s*/\\s*lot${BATCH_LABEL_TAIL}${SEP}(.+)$`, "i"),
  new RegExp(`^batch${BATCH_LABEL_TAIL}${SEP}(.+)$`, "i"),
  new RegExp(`^lot${BATCH_LABEL_TAIL}${SEP}(.+)$`, "i"),
];

const DATE_PATTERNS = [
  new RegExp(`^test\\s*date\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^date\\s*tested\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^date\\s*of\\s*analysis\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^analysis\\s*date\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^report\\s*date\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^coa\\s*date\\s*${SEP}(.+)$`, "i"),
];

const METHOD_PATTERNS = [
  new RegExp(`^test\\s*method\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^testing\\s*method\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^analytical\\s*method\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^analysis\\s*method\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^method\\s*${SEP}(.+)$`, "i"),
];

const LAB_PATTERNS = [
  new RegExp(`^testing\\s*laboratory\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^test(?:ing)?\\s*lab\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^laboratory\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^tested\\s*by\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^analyzed\\s*by\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^lab\\s*name\\s*${SEP}(.+)$`, "i"),
  new RegExp(`^lab\\s*${SEP}(.+)$`, "i"),
];

// Cut a line into the columns it holds. Real COAs, and the OCR of one, are mostly two-column
// tables: the label on the left, the value some distance to the right, with nothing but
// whitespace between them. A wide gap is a column boundary. A gap that touches a separator is
// not - "Purity   :    98.5 %" is one field with padding around its colon, not three columns.
function segments(line) {
  const parts = [];
  let start = 0;
  COLUMN_GAP.lastIndex = 0;
  let gap;
  while ((gap = COLUMN_GAP.exec(line)) !== null) {
    const end = gap.index + gap[0].length;
    const before = gap.index > 0 ? line[gap.index - 1] : "";
    const after = end < line.length ? line[end] : "";
    if (SEP_CHARS.includes(before) || SEP_CHARS.includes(after)) continue;
    const piece = line.slice(start, gap.index).trim();
    if (piece) parts.push(piece);
    start = end;
    if (parts.length >= MAX_LINE_SEGMENTS) return parts;
  }
  const rest = line.slice(start).trim();
  if (rest) parts.push(rest);
  return parts;
}

// The label/value strings a line could hold, in two tiers. The first tier is the columns
// themselves, which is where a line carrying two complete fields ("Test Method: RP-HPLC
// Test Date: 2026-02-14") gets read correctly instead of the first field swallowing the
// second. The second tier joins each neighbouring pair of columns with a colon, which is what
// makes a punctuation-free table row ("Purity (HPLC)      99.1 %") parse at all. Tier one is
// tried first for every pattern, so a line that already spells out its separator never gets
// reinterpreted as a table row.
function candidates(line) {
  const segs = segments(line);
  if (segs.length < 2) return [segs, []];
  const joined = [];
  for (let i = 0; i < segs.length - 1; i++) joined.push(`${segs[i]}: ${segs[i + 1]}`);
  return [segs, joined];
}

// Yield every pattern match across the document, in priority order.
function* iterMatches(lines, patterns) {
  for (const line of lines) {
    for (const tier of candidates(line)) {
      for (const candidate of tier) {
        for (const pattern of patterns) {
          const m = pattern.exec(candidate);
          if (m) yield m;
        }
      }
    }
  }
}

function firstTextMatch(lines, patterns) {
  for (const m of iterMatches(lines, patterns)) {
    const value = m[1].trim();
    if (value) return value;
  }
  return null;
}

// Parse a captured numeric token to a number, or null if it isn't usable. Commas are read as
// thousands separators when the token is grouped like "1,000" and as a decimal point
// otherwise ("98,99"). A token that overflows to Infinity (an absurdly long digit run) is
// dropped rather than passed on as a non-finite number.
function toFloat(token) {
  const normalized = THOUSANDS_GROUPED.test(token)
    ? token.replaceAll(",", "")
    : token.replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

// The first labeled mass in the document, converted to mg. Group 1 is the number, group 2 the
// unit it was written in. A unit the conversion table doesn't know is skipped rather than
// guessed at, so the field comes back missing instead of wrong by a factor of a thousand.
function firstMassMatch(lines, patterns) {
  for (const m of iterMatches(lines, patterns)) {
    const value = toFloat(m[1]);
    const factor = MASS_UNIT_TO_MG[m[2].toLowerCase()];
    if (value !== null && factor !== undefined) return value * factor;
  }
  return null;
}

// Map a word-form qualifier onto the symbol it means. "NLT 98%" and ">=98%" say the same thing,
// and redflags.js only knows the symbols, so the words are folded into them here. Symbols pass
// through untouched so the report still shows a document its own notation back.
function normalizeQualifier(token) {
  if (token === undefined || token === null) return null;
  const key = token.trim().toLowerCase().replace(WHITESPACE_RUN, " ");
  return Object.prototype.hasOwnProperty.call(QUALIFIER_WORDS, key) ? QUALIFIER_WORDS[key] : token;
}

// Like firstMassMatch, but for a percentage that may carry a leading qualifier ("<98.5%",
// ">=99%", "NLT 98%"). Returns [value, qualifier]; qualifier is null when none was written.
function firstPctMatch(lines, patterns) {
  for (const m of iterMatches(lines, patterns)) {
    const value = toFloat(m[2]);
    if (value !== null) return [value, normalizeQualifier(m[1])];
  }
  return [null, null];
}

/**
 * Extract COA fields from a text blob.
 *
 * Scans line by line, top to bottom; for each field the first line that matches one of its
 * known label variants wins. Missing fields come back as null rather than throwing - a
 * mostly-empty document is a valid (and useful) input, since a missing field is itself
 * signal for the red-flag checklist in redflags.js.
 *
 * @param {string} text
 * @returns {{product_name: ?string, purity_pct: ?number, net_content_pct: ?number,
 *   mass_mg: ?number, batch_lot: ?string, test_date: ?string, method: ?string,
 *   lab_name: ?string}}
 * @throws {TypeError} if `text` isn't a string.
 * @throws {RangeError} if `text` is larger than MAX_COA_TEXT_CHARS.
 */
export function parseCoa(text) {
  if (typeof text !== "string") {
    throw new TypeError(`coa text must be a string, got ${typeof text}`);
  }
  if (text.length > MAX_COA_TEXT_CHARS) {
    throw new RangeError(
      `input text is too large to parse (${text.length} chars, max ${MAX_COA_TEXT_CHARS})`,
    );
  }

  // A leading UTF-8 BOM (U+FEFF) would cling to the first line and stop it matching a label.
  // Python's parse_coa lstrips it too; drop it here so the two engines agree on BOM'd input.
  const cleaned = text.replace(/^\ufeff+/, "");
  const lines = cleaned.split(LINE_SPLIT);
  const [purityPct, purityQualifier] = firstPctMatch(lines, PURITY_PATTERNS);
  const [netContentPct, netContentQualifier] = firstPctMatch(lines, NET_CONTENT_PATTERNS);
  return {
    product_name: firstTextMatch(lines, PRODUCT_PATTERNS),
    purity_pct: purityPct,
    purity_qualifier: purityQualifier,
    net_content_pct: netContentPct,
    net_content_qualifier: netContentQualifier,
    mass_mg: firstMassMatch(lines, MASS_PATTERNS),
    batch_lot: firstTextMatch(lines, BATCH_PATTERNS),
    test_date: firstTextMatch(lines, DATE_PATTERNS),
    method: firstTextMatch(lines, METHOD_PATTERNS),
    lab_name: firstTextMatch(lines, LAB_PATTERNS),
  };
}
