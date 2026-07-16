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

// Optional qualifier some COAs put in front of a percentage ("Purity: >=98%"). Stripped
// and ignored; the number itself is what gets reported.
const QUALIFIER = "(?:>=|<=|~|>|<|≥|≤)?\\s*";

// A decimal number, accepting either a dot or a comma as the separator - COAs from outside
// the US/UK commonly write "98,99%" rather than "98.99%". firstFloatMatch normalizes the
// comma before calling Number() on it.
const DECIMAL_VALUE = "(\\d+(?:[.,]\\d+)?)";
const PCT_VALUE = `${QUALIFIER}${DECIMAL_VALUE}\\s*%?`;

const PRODUCT_PATTERNS = [
  /^product\s*name\s*[:-]\s*(.+)$/i,
  /^product\s*[:-]\s*(.+)$/i,
  /^peptide\s*name\s*[:-]\s*(.+)$/i,
  /^compound\s*name\s*[:-]\s*(.+)$/i,
  /^item\s*name\s*[:-]\s*(.+)$/i,
];

const PURITY_PATTERNS = [
  new RegExp(`^(?:hplc\\s+)?purity\\s*(?:\\([^)]*\\))?\\s*[:-]\\s*${PCT_VALUE}`, "i"),
];

const NET_CONTENT_PATTERNS = [
  new RegExp(`^net\\s*peptide\\s*content\\s*(?:\\([^)]*\\))?\\s*[:-]\\s*${PCT_VALUE}`, "i"),
  new RegExp(`^net\\s*content\\s*(?:\\([^)]*\\))?\\s*[:-]\\s*${PCT_VALUE}`, "i"),
  new RegExp(`^peptide\\s*content\\s*(?:\\([^)]*\\))?\\s*[:-]\\s*${PCT_VALUE}`, "i"),
];

const MASS_PATTERNS = [
  new RegExp(`^net\\s*weight\\s*[:-]\\s*${DECIMAL_VALUE}\\s*mg\\b`, "i"),
  new RegExp(`^quantity\\s*[:-]\\s*${DECIMAL_VALUE}\\s*mg\\b`, "i"),
  new RegExp(`^vial\\s*(?:content|weight|size)\\s*[:-]\\s*${DECIMAL_VALUE}\\s*mg\\b`, "i"),
  new RegExp(`^fill\\s*weight\\s*[:-]\\s*${DECIMAL_VALUE}\\s*mg\\b`, "i"),
  new RegExp(`^(?:mass|weight)\\s*[:-]\\s*${DECIMAL_VALUE}\\s*mg\\b`, "i"),
];

const BATCH_PATTERNS = [
  /^batch\s*\/\s*lot\s*(?:no\.?|number)?\s*[:-]\s*(\S+)/i,
  /^batch\s*(?:no\.?|number)?\s*[:-]\s*(\S+)/i,
  /^lot\s*(?:no\.?|number)?\s*[:-]\s*(\S+)/i,
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

function firstFloatMatch(lines, patterns) {
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped) continue;
    for (const pattern of patterns) {
      const m = pattern.exec(stripped);
      if (m) {
        const value = Number(m[1].replace(",", "."));
        if (!Number.isNaN(value)) return value;
      }
    }
  }
  return null;
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

  const lines = text.split(/\r\n|\r|\n/);
  return {
    product_name: firstTextMatch(lines, PRODUCT_PATTERNS),
    purity_pct: firstFloatMatch(lines, PURITY_PATTERNS),
    net_content_pct: firstFloatMatch(lines, NET_CONTENT_PATTERNS),
    mass_mg: firstFloatMatch(lines, MASS_PATTERNS),
    batch_lot: firstTextMatch(lines, BATCH_PATTERNS),
    test_date: firstTextMatch(lines, DATE_PATTERNS),
    method: firstTextMatch(lines, METHOD_PATTERNS),
    lab_name: firstTextMatch(lines, LAB_PATTERNS),
  };
}
