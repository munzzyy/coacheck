// Mechanical red-flag checklist for a parsed COA.
//
// JS port of coacheck/redflags.py. Every check below is a deterministic rule over the
// fields parser.js already extracted - no inference about the document beyond "is this
// field present, and is the number in it physically possible". Each check returns exactly
// one flag with a stable id, so a caller (or a test) can key off CC-PURITY the same way
// whether the underlying wording of the report changes or not.
//
// These are hygiene and plausibility checks, not a verdict. A clean checklist means
// nothing obvious is missing or impossible; it is not a claim that the document is
// genuine, and a flagged document is not proof it's fake.

// Purity line vendors commonly use for "research grade" material. This is a labeling
// convention this tool checks against, not a clinical or medical threshold, and not a
// claim that material below it is unsafe or fake.
export const RESEARCH_GRADE_PURITY_THRESHOLD = 98.0;

// Purity qualifiers that make the stated number an upper bound rather than a confirmed value -
// "<98%" says purity is below 98, not that it is 98.
const UPPER_BOUND_QUALIFIERS = new Set(["<", "<=", "≤"]);

// Lab-name values that are present but don't actually name a lab. Matched against the
// normalized value (see isPlaceholderLab), so "N.A.", "In-House Lab" and the like are caught
// too, not just the exact strings here.
const PLACEHOLDER_LAB_VALUES = new Set([
  "n/a", "na", "n.a.", "none", "in-house", "in house", "inhouse", "internal",
  "internal lab", "undisclosed", "confidential", "private", "tbd", "unknown",
  "not disclosed", "not specified", "not provided", "pending", "unavailable",
]);

// Generic trailing words a placeholder is often padded with ("In-House Lab", "Internal
// Laboratory"). Dropped before the placeholder check so the padding doesn't hide it.
const GENERIC_LAB_WORDS = ["laboratories", "laboratory", "labs", "lab"];

export const Status = Object.freeze({
  PASS: "pass",
  WARN: "warn",
  FAIL: "fail",
});

// Mirrors Python's `f"{value:g}"` - shortest 6-significant-digit form, trailing zeros and a
// trailing decimal point trimmed. Only the detail strings below use this, but the parity
// checker compares those strings verbatim against the real Python output, so it has to
// match exactly for every value the fixtures exercise, not just look close.
function formatG(value) {
  if (!Number.isFinite(value)) {
    return value > 0 ? "inf" : value < 0 ? "-inf" : "nan";
  }
  if (value === 0) return "0";
  const precision = 6;
  // %e form with (precision - 1) fractional digits gives the rounded mantissa and the decimal
  // exponent %g keys off of.
  const [mantissa, expPart] = value.toExponential(precision - 1).split("e");
  const exp = parseInt(expPart, 10);
  if (exp < -4 || exp >= precision) {
    const trimmed = mantissa.replace(/\.?0+$/, "");
    const sign = exp < 0 ? "-" : "+";
    return `${trimmed}e${sign}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  let s = value.toFixed(Math.max(0, precision - 1 - exp));
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

// Mirrors Python's repr() for a plain string: single-quoted, switching to double quotes
// only if the string itself contains a single quote (and no double quote).
function pyRepr(s) {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    if (ch === "\\") out += "\\\\";
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else out += ch;
  }
  return out + quote;
}

function normalizeLab(value) {
  const collapsed = value.trim().toLowerCase().replace(/\s+/g, " ");
  return collapsed.replace(/^[ .]+|[ .]+$/g, "");
}

function isPlaceholderLab(value) {
  const v = normalizeLab(value);
  if (!v) return true;
  // No letters or digits at all ("-", "--", ".").
  if (!/[a-z0-9]/.test(v)) return true;
  // "n/a", "n.a.", "n a" all collapse to the same non-answer.
  if (v.replace(/[^a-z0-9]/g, "") === "na") return true;
  if (PLACEHOLDER_LAB_VALUES.has(v)) return true;
  // "In-House Lab" -> "in-house"; a real name like "Private Analytics" keeps its
  // distinguishing word and is left alone.
  for (const word of GENERIC_LAB_WORDS) {
    if (v.endsWith(` ${word}`)) {
      if (PLACEHOLDER_LAB_VALUES.has(v.slice(0, v.length - word.length - 1).trim())) return true;
      break;
    }
  }
  return false;
}

function checkPurity(coa) {
  if (coa.purity_pct === null) {
    return {
      id: "CC-PURITY", status: Status.FAIL,
      title: "No purity percentage found",
      detail: "The document does not state an HPLC purity percentage anywhere. "
        + "A COA without a purity figure can't be used to judge quality.",
    };
  }
  if (!Number.isFinite(coa.purity_pct) || coa.purity_pct < 0 || coa.purity_pct > 100) {
    return {
      id: "CC-PURITY", status: Status.FAIL,
      title: "Stated purity is not physically possible",
      detail: `Purity is stated as ${formatG(coa.purity_pct)}%, which is outside the `
        + "possible 0-100% range.",
    };
  }
  if (UPPER_BOUND_QUALIFIERS.has(coa.purity_qualifier)) {
    return {
      id: "CC-PURITY", status: Status.WARN,
      title: "Purity stated only as an upper bound",
      detail: `Stated purity is ${coa.purity_qualifier}${formatG(coa.purity_pct)}%, given `
        + "only as an upper bound rather than a confirmed value, so it can't "
        + `be checked against the ${formatG(RESEARCH_GRADE_PURITY_THRESHOLD)}% `
        + "research-grade line.",
    };
  }
  if (coa.purity_pct < RESEARCH_GRADE_PURITY_THRESHOLD) {
    return {
      id: "CC-PURITY", status: Status.WARN,
      title: "Purity below the research-grade reference line",
      detail: `Stated purity is ${formatG(coa.purity_pct)}%, below the `
        + `${formatG(RESEARCH_GRADE_PURITY_THRESHOLD)}% line this tool checks `
        + "research-grade material against.",
    };
  }
  return {
    id: "CC-PURITY", status: Status.PASS,
    title: "Purity at or above the research-grade line",
    detail: `Stated purity is ${formatG(coa.purity_pct)}%.`,
  };
}

function checkBatch(coa) {
  if (!coa.batch_lot) {
    return {
      id: "CC-BATCH", status: Status.WARN,
      title: "No batch/lot number found",
      detail: "The document doesn't reference a batch or lot number, so this "
        + "result can't be tied to a specific production run.",
    };
  }
  return {
    id: "CC-BATCH", status: Status.PASS,
    title: "Batch/lot number present",
    detail: `Batch/lot: ${coa.batch_lot}`,
  };
}

function checkLab(coa) {
  if (!coa.lab_name) {
    return {
      id: "CC-LAB", status: Status.WARN,
      title: "No testing laboratory named",
      detail: "The document doesn't name the lab that ran the test.",
    };
  }
  if (isPlaceholderLab(coa.lab_name)) {
    return {
      id: "CC-LAB", status: Status.WARN,
      title: "Testing laboratory not actually named",
      detail: `The lab field holds a placeholder value (${pyRepr(coa.lab_name)}) `
        + "rather than a lab name.",
    };
  }
  return {
    id: "CC-LAB", status: Status.PASS,
    title: "Testing laboratory named",
    detail: `Lab: ${coa.lab_name}`,
  };
}

function checkMethod(coa) {
  if (!coa.method) {
    return {
      id: "CC-METHOD", status: Status.WARN,
      title: "No test method found",
      detail: "The document doesn't name the analytical method used (e.g. "
        + "HPLC, HPLC-MS).",
    };
  }
  return {
    id: "CC-METHOD", status: Status.PASS,
    title: "Test method named",
    detail: `Method: ${coa.method}`,
  };
}

function checkDate(coa) {
  if (!coa.test_date) {
    return {
      id: "CC-DATE", status: Status.WARN,
      title: "No test date found",
      detail: "The document doesn't state when the test was run.",
    };
  }
  return {
    id: "CC-DATE", status: Status.PASS,
    title: "Test date present",
    detail: `Test date: ${coa.test_date}`,
  };
}

function checkPurityBackedByMethod(coa) {
  if (coa.purity_pct === null) {
    return {
      id: "CC-PURITY-METHOD", status: Status.PASS,
      title: "No purity claim to check",
      detail: "No purity percentage was found, so there's no claim here to "
        + "check against a method (see CC-PURITY).",
    };
  }
  if (!coa.method) {
    return {
      id: "CC-PURITY-METHOD", status: Status.WARN,
      title: "Purity stated without a named test method",
      detail: `A purity of ${formatG(coa.purity_pct)}% is stated, but no analytical `
        + "method backs it up anywhere in the document.",
    };
  }
  return {
    id: "CC-PURITY-METHOD", status: Status.PASS,
    title: "Purity is backed by a named method",
    detail: `Method: ${coa.method}`,
  };
}

function checkNetContent(coa) {
  if (coa.net_content_pct === null) {
    return {
      id: "CC-NET", status: Status.PASS,
      title: "No net peptide content stated",
      detail: "Net peptide content is an optional field on most COAs; none "
        + "was found in this document.",
    };
  }
  const value = coa.net_content_pct;
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    return {
      id: "CC-NET", status: Status.FAIL,
      title: "Net peptide content is not physically plausible",
      detail: `Net peptide content is stated as ${formatG(value)}%, which is outside `
        + "the physically possible 0-100% range.",
    };
  }
  return {
    id: "CC-NET", status: Status.PASS,
    title: "Net peptide content is within a plausible range",
    detail: `Net peptide content: ${formatG(value)}%`,
  };
}

// Order here is the order flags are returned in, and the order they render in.
const CHECKS = [
  checkPurity,
  checkBatch,
  checkLab,
  checkMethod,
  checkDate,
  checkPurityBackedByMethod,
  checkNetContent,
];

/**
 * Run every red-flag check against a parsed COA and return all 7 flags.
 * @param {object} coa - a ParsedCoa-shaped object, see parser.js.
 * @returns {{id: string, status: string, title: string, detail: string}[]}
 */
export function runChecklist(coa) {
  return CHECKS.map((check) => check(coa));
}
