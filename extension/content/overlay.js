// Region-select + results overlay, injected on demand (toolbar click or the keyboard
// shortcut) via chrome.scripting.executeScript - never a persistent content script, so
// there's nothing running on a page the user hasn't asked to read. Loaded together with
// shared/render-dom.js (same files array, same global scope), which is what actually
// builds the results DOM.
//
// Both the selection box and the results panel live in closed shadow roots, styled with
// direct CSSOM property assignment rather than a <style> tag - a shadow root's styles are
// still governed by the host document's style-src CSP, but property assignment isn't, so
// this survives a strict host page CSP the same way cardsight's overlay does. All rendered
// text goes through render-dom.js's `textContent`-only builders - see that file's header.
"use strict";

(function () {
  if (window.__coacheckSelecting) return;
  window.__coacheckSelecting = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const HOST_ID = "coacheck-overlay-host";

  function removeHost() {
    document.getElementById(HOST_ID)?.remove();
  }

  function mountShadow() {
    removeHost();
    const host = document.createElement("div");
    host.id = HOST_ID;
    Object.assign(host.style, { all: "initial", position: "fixed", zIndex: "2147483647" });
    document.documentElement.append(host);
    return host.attachShadow({ mode: "closed" });
  }

  function startSelection() {
    const host = document.createElement("div");
    host.id = HOST_ID;
    Object.assign(host.style, {
      all: "initial", position: "fixed", inset: "0", zIndex: "2147483647",
      cursor: "crosshair",
    });
    document.documentElement.append(host);
    const root = host.attachShadow({ mode: "closed" });

    const veil = document.createElement("div");
    Object.assign(veil.style, {
      position: "fixed", inset: "0", background: "rgba(10,14,18,.25)",
      // Without this, a touchscreen treats the drag as a page-scroll/pan gesture instead of
      // handing it to the pointer* listeners below - pointer events alone aren't enough.
      touchAction: "none",
    });
    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed", border: "2px solid #4cc38a", background: "rgba(76,195,138,.15)",
      display: "none",
    });
    const hint = document.createElement("div");
    hint.textContent = "drag over the COA - esc to cancel";
    Object.assign(hint.style, {
      position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)",
      font: "12.5px ui-sans-serif, system-ui, sans-serif", background: "#1a2027",
      color: "#dde4ea", border: "1px solid #2a323c", borderRadius: "8px", padding: "6px 12px",
    });
    root.append(veil, box, hint);

    // Pointer events (not mousedown/mousemove/mouseup) so the same handlers drive a
    // one-finger drag on a touchscreen and a mouse drag on desktop - no separate touch
    // codepath to keep in sync.
    let start = null;

    function onPointerDown(e) {
      if (e.button !== 0 && e.pointerType !== "touch") return;
      start = { x: e.clientX, y: e.clientY };
      veil.setPointerCapture(e.pointerId);
      Object.assign(box.style, { display: "block", left: `${start.x}px`, top: `${start.y}px`, width: "0px", height: "0px" });
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!start) return;
      const left = Math.min(start.x, e.clientX);
      const top = Math.min(start.y, e.clientY);
      const width = Math.abs(e.clientX - start.x);
      const height = Math.abs(e.clientY - start.y);
      Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    }

    function onPointerUp(e) {
      if (!start) return;
      const left = Math.min(start.x, e.clientX);
      const top = Math.min(start.y, e.clientY);
      const width = Math.abs(e.clientX - start.x);
      const height = Math.abs(e.clientY - start.y);
      cleanup();
      // A drag under 6x6 CSS px reads as an accidental click/tap, not an intended selection.
      if (width < 6 || height < 6) {
        window.__coacheckSelecting = false;
        return;
      }
      processRegion({ left, top, width, height });
    }

    function onKeyDown(e) {
      if (e.key === "Escape") {
        cleanup();
        window.__coacheckSelecting = false;
      }
    }

    function cleanup() {
      veil.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown, true);
      removeHost();
    }

    veil.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown, true);
  }

  async function processRegion(rect) {
    const root = mountShadow();
    Object.assign(root.host.style, { top: "16px", right: "16px" });
    root.append(window.CoacheckRender.buildLoadingBadge());

    function showPanel(node) {
      root.replaceChildren(node);
    }

    try {
      const resp = await api.runtime.sendMessage({
        cmd: "process-region",
        rect,
        dpr: window.devicePixelRatio || 1,
      });
      window.__coacheckSelecting = false;
      if (!resp || !resp.ok) throw new Error(resp?.error || "processing failed");
      showPanel(window.CoacheckRender.buildResultsPanel(resp.result, { onClose: removeHost }));
    } catch (err) {
      window.__coacheckSelecting = false;
      showPanel(window.CoacheckRender.buildErrorPanel(err?.message || err, { onClose: removeHost }));
    }
  }

  startSelection();
})();
