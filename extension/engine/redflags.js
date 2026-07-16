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

// Lab-name values that are present but don't actually name a lab.
const PLACEHOLDER_LAB_VALUES = new Set([
  "n/a", "na", "none", "in-house", "in house", "internal",
  "internal lab", "undisclosed", "confidential", "private",
]);

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
  let s = value.toPrecision(6);
  if (s.includes("e") || s.includes("E")) {
    return Number(s).toString();
  }
  if (s.includes(".")) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
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

function isPlaceholderLab(value) {
  return PLACEHOLDER_LAB_VALUES.has(value.trim().toLowerCase());
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
