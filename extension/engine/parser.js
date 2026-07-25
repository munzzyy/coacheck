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

// Optional qualifier some COAs put in front of a percentage ("Purity: >=98%"). Captured so
// the checklist can tell a confirmed value from a bound: "<98%" is an upper bound, not a
// claim that purity is 98%.
const QUALIFIER = "(?:(>=|<=|~|>|<|≥|≤)\\s*)?";

// A decimal number, accepting either a dot or a comma as the separator - COAs from outside
// the US/UK commonly write "98,99%" rather than "98.99%". \d is ASCII here, which the Python
// port matches ([0-9]) so non-ASCII digits behave the same in both. toFloat sorts out
// comma-as-decimal vs comma-as-thousands-separator.
const DECIMAL_VALUE = "(\\d+(?:[.,]\\d+)?)";
const PCT_VALUE = `${QUALIFIER}${DECIMAL_VALUE}\\s*%?`;

// A number written with commas as thousands separators ("1,000", "5,000"). Told apart from a
// comma decimal ("98,99") so "1,000 mg" isn't read as 1 mg.
const THOUSANDS_GROUPED = /^\d{1,3}(?:,\d{3})+$/;

// Python's str.splitlines() breaks on more than \r\n/\r/\n - vertical tab, form feed, the
// file/group/record separators, NEL, and the Unicode line/paragraph separators too. Match
// that set so the same bytes split into the same lines in both engines.
const LINE_SPLIT = /\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/;

const PRODUCT_PATTERNS = [
  /^product\s*name\s*[:-]\s*(.+)$/i,
  /^product\s*[:-]\s*(.+)$/i,
  /^peptide\s*name\s*[:-]\s*(.+)$/i,
  /^compound\s*name\s*[:-]\s*(.+)$/i,
  /^item\s*name\s*[:-]\s*(.+)$/i,
];

// The trailing whitespace is pulled inside the optional group ("(?:\(...\)\s*)?" rather than
// "(?:\(...\))?\s*") so there are never two free-floating \s* runs on either side of an
// empty-matchable group - that adjacency is what makes the scan quadratic on a long run of
// whitespace.
const PURITY_PATTERNS = [
  new RegExp(`^(?:hplc\\s+)?purity\\s*(?:\\([^)]*\\)\\s*)?[:-]\\s*${PCT_VALUE}`, "i"),
];

const NET_CONTENT_PATTERNS = [
  new RegExp(`^net\\s*peptide\\s*content\\s*(?:\\([^)]*\\)\\s*)?[:-]\\s*${PCT_VALUE}`, "i"),
  new RegExp(`^net\\s*content\\s*(?:\\([^)]*\\)\\s*)?[:-]\\s*${PCT_VALUE}`, "i"),
  new RegExp(`^peptide\\s*content\\s*(?:\\([^)]*\\)\\s*)?[:-]\\s*${PCT_VALUE}`, "i"),
];

const MASS_PATTERNS = [
  new RegExp(`^net\\s*weight\\s*[:-]\\s*${DECIMAL_VALUE}\\s*mg\\b`, "i"),
  new RegExp(`^quantity\\s*[:-]\\s*${DECIMAL_VALUE}\\s*mg\\b`, "i"),
  new RegExp(`^vial\\s*(?:content|weight|size)\\s*[:-]\\s*${DECIMAL_VALUE}\\s*mg\\b`, "i"),
  new RegExp(`^fill\\s*weight\\s*[:-]\\s*${DECIMAL_VALUE}\\s*mg\\b`, "i"),
  new RegExp(`^(?:mass|weight)\\s*[:-]\\s*${DECIMAL_VALUE}\\s*mg\\b`, "i"),
];

const BATCH_PATTERNS = [
  /^batch\s*\/\s*lot\s*(?:(?:no\.?|number)\s*)?[:-]\s*(\S+)/i,
  /^batch\s*(?:(?:no\.?|number)\s*)?[:-]\s*(\S+)/i,
  /^lot\s*(?:(?:no\.?|number)\s*)?[:-]\s*(\S+)/i,
];

const DATE_PATTERNS = [
  /^test\s*date\s*[:-]\s*(.+)$/i,
  /^date\s*tested\s*[:-]\s*(.+)$/i,
  /^date\s*of\s*analysis\s*[:-]\s*(.+)$/i,
  /^analysis\s*date\s*[:-]\s*(.+)$/i,
  /^report\s*date\s*[:-]\s*(.+)$/i,
  /^coa\s*date\s*[:-]\s*(.+)$/i,
];

const METHOD_PATTERNS = [
  /^test\s*method\s*[:-]\s*(.+)$/i,
  /^testing\s*method\s*[:-]\s*(.+)$/i,
  /^analytical\s*method\s*[:-]\s*(.+)$/i,
  /^analysis\s*method\s*[:-]\s*(.+)$/i,
  /^method\s*[:-]\s*(.+)$/i,
];

const LAB_PATTERNS = [
  /^testing\s*laboratory\s*[:-]\s*(.+)$/i,
  /^test(?:ing)?\s*lab\s*[:-]\s*(.+)$/i,
  /^laboratory\s*[:-]\s*(.+)$/i,
  /^tested\s*by\s*[:-]\s*(.+)$/i,
  /^analyzed\s*by\s*[:-]\s*(.+)$/i,
  /^lab\s*name\s*[:-]\s*(.+)$/i,
  /^lab\s*[:-]\s*(.+)$/i,
];

function firstTextMatch(lines, patterns) {
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped) continue;
    for (const pattern of patterns) {
      const m = pattern.exec(stripped);
      if (m) {
        const value = m[1].trim();
        if (value) return value;
      }
    }
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

function firstFloatMatch(lines, patterns) {
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped) continue;
    for (const pattern of patterns) {
      const m = pattern.exec(stripped);
      if (m) {
        const value = toFloat(m[1]);
        if (value !== null) return value;
      }
    }
  }
  return null;
}

// Like firstFloatMatch, but for a percentage that may carry a leading qualifier ("<98.5%",
// ">=99%"). Returns [value, qualifier]; qualifier is null when none was written.
function firstPctMatch(lines, patterns) {
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped) continue;
    for (const pattern of patterns) {
      const m = pattern.exec(stripped);
      if (m) {
        const value = toFloat(m[2]);
        if (value !== null) return [value, m[1] ?? null];
      }
    }
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
    mass_mg: firstFloatMatch(lines, MASS_PATTERNS),
    batch_lot: firstTextMatch(lines, BATCH_PATTERNS),
    test_date: firstTextMatch(lines, DATE_PATTERNS),
    method: firstTextMatch(lines, METHOD_PATTERNS),
    lab_name: firstTextMatch(lines, LAB_PATTERNS),
  };
}
