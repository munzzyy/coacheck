// Builds the results UI as real DOM nodes - never innerHTML, never a template string with
// parsed/OCR'd text spliced in. Everything that came out of a document (product names,
// batch numbers, lab names, the raw OCR text) is untrusted input and goes through
// `textContent` or `Text` nodes exclusively, the one sink this file uses for it.
//
// Classic script (no import/export) on purpose: it's loaded two ways that both require a
// plain global-scope file rather than an ES module - popup.html's <script src>, and
// chrome.scripting.executeScript's `files` array for the content-script injection (which
// has no ES module option). Both get it by declaring `window.CoacheckRender`.
"use strict";

(function (global) {
  const api = globalThis.browser ?? globalThis.chrome;

  const FIELD_LABELS = [
    ["product_name", "Product name"],
    ["purity_pct", "HPLC purity"],
    ["net_content_pct", "Net peptide content"],
    ["mass_mg", "Mass / quantity"],
    ["batch_lot", "Batch / lot"],
    ["test_date", "Test date"],
    ["method", "Test method"],
    ["lab_name", "Testing lab"],
  ];

  const STATUS_COLOR = { pass: "#4cc38a", warn: "#e5c07b", fail: "#e06c75" };

  // Mirrors report.py's `f"{value:g}"` - see engine/redflags.js's formatG for the same
  // helper on the engine side. Duplicated rather than imported: this file is a classic
  // script and can't `import` the engine's ES modules.
  function formatG(value) {
    if (!Number.isFinite(value)) return String(value);
    let s = value.toPrecision(6);
    if (s.includes("e") || s.includes("E")) return Number(s).toString();
    if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }

  function fieldText(coa, name) {
    const value = coa[name];
    if (value === null || value === undefined) return "(not found)";
    if (name === "purity_pct" || name === "net_content_pct") return `${formatG(value)}%`;
    if (name === "mass_mg") return `${formatG(value)} mg`;
    return String(value);
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (key === "style") Object.assign(node.style, value);
        else if (key === "text") node.textContent = value;
        else if (key.startsWith("on") && typeof value === "function") {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else {
          node.setAttribute(key, value);
        }
      }
    }
    for (const child of children || []) {
      if (child === null || child === undefined) continue;
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  function buildFieldsSection(coa) {
    const rows = FIELD_LABELS.map(([name, label]) =>
      el("div", { style: { display: "flex", gap: "8px", padding: "2px 0" } }, [
        el("span", { style: { color: "#8b98a5", minWidth: "168px", flexShrink: "0" }, text: label }),
        el("span", { text: fieldText(coa, name) }),
      ]));
    return el("div", null, [
      el("div", { style: { fontWeight: "700", marginBottom: "4px" }, text: "Parsed fields" }),
      ...rows,
    ]);
  }

  function buildPurityBlock(purity, purityError) {
    if (!purity) {
      return el("div", { style: { marginTop: "10px", color: "#8b98a5" } }, [
        el("div", { style: { fontWeight: "700", color: "#dde4ea", marginBottom: "4px" }, text: "Purity math" }),
        el("div", { text: `Not computed: ${purityError}` }),
      ]);
    }
    const deliveredPct = 100.0 - purity.shortfall_pct;
    return el("div", { style: { marginTop: "10px" } }, [
      el("div", { style: { fontWeight: "700", marginBottom: "4px" }, text: "Purity math" }),
      el("div", null, [`Labeled mass: ${formatG(purity.labeled_mg)} mg`]),
      el("div", null, [
        `Actual deliverable peptide: ${purity.actual_mg.toFixed(3)} mg `
          + `(${deliveredPct.toFixed(1)}% of labeled)`,
      ]),
      el("div", null, [
        `Shortfall: ${purity.shortfall_mg.toFixed(3)} mg (${purity.shortfall_pct.toFixed(1)}%)`,
      ]),
    ]);
  }

  function buildChecklistSection(flags) {
    const rows = flags.map((flag) =>
      el("div", { style: { marginTop: "6px" } }, [
        el("div", { style: { display: "flex", gap: "6px", alignItems: "baseline" } }, [
          el("span", {
            style: {
              color: STATUS_COLOR[flag.status] || "#8b98a5",
              fontWeight: "700",
              fontSize: "10.5px",
              minWidth: "38px",
            },
            text: flag.status.toUpperCase(),
          }),
          el("span", { style: { fontWeight: "600" }, text: flag.title }),
        ]),
        el("div", { style: { color: "#8b98a5", fontSize: "11.5px", marginLeft: "44px" }, text: flag.detail }),
      ]));
    const counts = { pass: 0, warn: 0, fail: 0 };
    for (const flag of flags) counts[flag.status] += 1;
    return el("div", { style: { marginTop: "10px" } }, [
      el("div", { style: { fontWeight: "700", marginBottom: "2px" }, text: "Red-flag checklist" }),
      ...rows,
      el("div", {
        style: { marginTop: "8px", color: "#8b98a5", fontSize: "11.5px" },
        text: `${counts.fail} fail, ${counts.warn} warn, ${counts.pass} pass (${flags.length} checks)`,
      }),
    ]);
  }

  function buildReconSection(coa) {
    if (coa.mass_mg === null || coa.mass_mg === undefined) {
      return el("div", { style: { marginTop: "10px", color: "#8b98a5", fontSize: "11.5px" } }, [
        "Reconstitution calculator needs a mass/quantity field, which wasn't found in this document.",
      ]);
    }

    const waterInput = el("input", {
      type: "number", min: "0", step: "any", placeholder: "water mL",
      style: { width: "84px" },
    });
    const doseInput = el("input", {
      type: "number", min: "0", step: "any", placeholder: "dose",
      style: { width: "84px" },
    });
    const unitSelect = el("select", null, [
      el("option", { value: "mcg", text: "mcg" }),
      el("option", { value: "mg", text: "mg" }),
    ]);
    const output = el("div", { style: { marginTop: "6px", color: "#8b98a5", fontSize: "11.5px" } });

    let debounceTimer = null;
    async function recompute() {
      const waterMl = Number(waterInput.value);
      const doseRaw = Number(doseInput.value);
      if (!(waterMl > 0) || !(doseRaw > 0)) {
        output.textContent = "";
        return;
      }
      const doseMcg = unitSelect.value === "mg" ? doseRaw * 1000 : doseRaw;
      try {
        const resp = await api.runtime.sendMessage({
          cmd: "recon", vialMg: coa.mass_mg, waterMl, doseMcg,
        });
        if (!resp || !resp.ok) throw new Error(resp?.error || "recon failed");
        const r = resp.result;
        output.textContent =
          `${r.concentration_mcg_per_ml.toFixed(1)} mcg/mL - draw ${r.ml_per_dose.toFixed(4)} mL `
          + `(${r.units_per_dose.toFixed(1)} units on a U-100 syringe) - `
          + `${r.doses_per_vial.toFixed(2)} doses/vial`
          + (r.exceeds_vial ? " - exceeds the whole vial's content" : "");
      } catch (err) {
        output.textContent = `error: ${err.message || err}`;
      }
    }
    function onChange() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(recompute, 150);
    }
    waterInput.addEventListener("input", onChange);
    doseInput.addEventListener("input", onChange);
    unitSelect.addEventListener("change", onChange);

    return el("div", { style: { marginTop: "10px" } }, [
      el("div", { style: { fontWeight: "700", marginBottom: "4px" }, text: "Reconstitution" }),
      el("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } }, [
        waterInput, el("span", { text: "water," }), doseInput, unitSelect, el("span", { text: "dose" }),
      ]),
      output,
    ]);
  }

  function buildOcrDisclosure(ocrText, openByDefault) {
    const details = el("details", openByDefault ? { open: "" } : null, [
      el("summary", { style: { cursor: "pointer", color: "#8b98a5", fontSize: "11.5px" }, text: "raw OCR text" }),
      el("pre", {
        style: {
          whiteSpace: "pre-wrap", wordBreak: "break-word", margin: "6px 0 0",
          font: "11px/1.5 ui-monospace, monospace", color: "#8b98a5",
          background: "#12161b", border: "1px solid #2a323c", borderRadius: "6px", padding: "8px",
          maxHeight: "160px", overflow: "auto",
        },
        text: ocrText,
      }),
    ]);
    return details;
  }

  function fieldsAreAllEmpty(coa) {
    return FIELD_LABELS.every(([name]) => coa[name] === null || coa[name] === undefined);
  }

  const POLICY_LINE =
    "Informational only - not medical advice. Doesn't endorse, recommend, or source any compound.";

  /**
   * Build the full results panel for a parsed COA (from OCR or pasted text).
   * @param {{coa: object, flags: object[], purity: ?object, purityError: ?string,
   *   ocrText: ?string}} payload
   * @param {{onClose: function}} [opts]
   * @returns {HTMLElement}
   */
  function buildResultsPanel(payload, opts) {
    const { coa, flags, purity, purityError, ocrText } = payload;
    const empty = ocrText !== null && ocrText !== undefined && fieldsAreAllEmpty(coa);

    const closeBtn = el("span", {
      text: "✕",
      style: { float: "right", cursor: "pointer", color: "#8b98a5", padding: "0 2px" },
      onClick: () => opts?.onClose?.(),
    });

    const children = [
      el("div", null, [
        closeBtn,
        el("b", { style: { fontSize: "15px" }, text: "coacheck" }),
      ]),
      el("div", { style: { color: "#8b98a5", fontSize: "10.5px", marginBottom: "8px" }, text: POLICY_LINE },
      ),
    ];

    if (empty) {
      children.push(el("div", {
        style: {
          background: "#2a2016", border: "1px solid #5a4326", color: "#e5c07b",
          borderRadius: "6px", padding: "8px 10px", fontSize: "11.5px", marginBottom: "8px",
        },
        text: "No COA fields recognized in that selection. Try a bigger or straighter crop "
          + "around just the COA text, a sharper screenshot, or paste the text in directly "
          + "from the toolbar popup.",
      }));
    }

    children.push(buildFieldsSection(coa));
    children.push(buildPurityBlock(purity, purityError));
    children.push(buildChecklistSection(flags));
    children.push(buildReconSection(coa));
    if (ocrText !== null && ocrText !== undefined) {
      children.push(el("div", { style: { marginTop: "10px" } }, [buildOcrDisclosure(ocrText, empty)]));
    }

    return el("div", {
      style: {
        font: "13px/1.45 ui-sans-serif, system-ui, sans-serif",
        background: "#1a2027", color: "#dde4ea", border: "1px solid #2a323c",
        borderRadius: "10px", padding: "12px 14px", width: "380px", maxWidth: "92vw",
        maxHeight: "80vh", overflow: "auto", boxShadow: "0 6px 24px rgba(0,0,0,.5)",
      },
    }, children);
  }

  /** Minimal panel for a hard failure (capture/OCR/engine threw). */
  function buildErrorPanel(message, opts) {
    const closeBtn = el("span", {
      text: "✕",
      style: { float: "right", cursor: "pointer", color: "#8b98a5", padding: "0 2px" },
      onClick: () => opts?.onClose?.(),
    });
    return el("div", {
      style: {
        font: "13px/1.45 ui-sans-serif, system-ui, sans-serif",
        background: "#1a2027", color: "#dde4ea", border: "1px solid #5a2a2e",
        borderRadius: "10px", padding: "12px 14px", width: "340px", maxWidth: "92vw",
        boxShadow: "0 6px 24px rgba(0,0,0,.5)",
      },
    }, [
      el("div", null, [closeBtn, el("b", { style: { fontSize: "15px", color: "#e06c75" }, text: "coacheck" })]),
      el("div", { style: { marginTop: "6px" }, text: "Couldn't read a COA here." }),
      el("div", { style: { marginTop: "6px", color: "#8b98a5", fontSize: "11.5px" }, text: String(message) }),
    ]);
  }

  /** A small "reading..." placeholder shown while capture/OCR is in flight. */
  function buildLoadingBadge() {
    return el("div", {
      style: {
        font: "12.5px ui-sans-serif, system-ui, sans-serif", background: "#1a2027",
        color: "#dde4ea", border: "1px solid #2a323c", borderRadius: "8px",
        padding: "8px 12px", boxShadow: "0 6px 24px rgba(0,0,0,.5)",
      },
      text: "coacheck: reading that region…",
    });
  }

  global.CoacheckRender = { buildResultsPanel, buildErrorPanel, buildLoadingBadge, fieldText };
})(typeof window !== "undefined" ? window : this);
