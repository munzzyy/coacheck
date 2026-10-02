"use strict";

const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const UNREADABLE = "Extensions can't read this page, so there's nothing to select here. "
  + "Paste the COA text below instead.";

async function send(msg) {
  const resp = await api.runtime.sendMessage(msg);
  if (!resp) throw new Error("no response from background");
  if (!resp.ok) throw new Error(resp.error);
  return resp.result;
}

function clearOutput() {
  $("result").replaceChildren();
  $("err").textContent = "";
}

$("select").addEventListener("click", async () => {
  clearOutput();
  try {
    const { started } = await send({ cmd: "start-select" });
    if (started) {
      window.close(); // the drag + results now happen on the page itself
      return;
    }
    $("err").textContent = UNREADABLE;
    $("text").focus();
  } catch (err) {
    $("err").textContent = String(err?.message || err);
  }
});

$("analyze").addEventListener("click", async () => {
  clearOutput();
  const text = $("text").value;
  if (!text.trim()) {
    $("err").textContent = "paste some COA text first";
    return;
  }
  const btn = $("analyze");
  btn.disabled = true;
  try {
    const result = await send({ cmd: "parse-text", text });
    const panel = window.CoacheckRender.buildResultsPanel(result, { onClose: clearOutput });
    $("result").replaceChildren(panel);
    panel.focus();
  } catch (err) {
    $("err").textContent = String(err?.message || err);
  } finally {
    btn.disabled = false;
  }
});
