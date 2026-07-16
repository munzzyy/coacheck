"use strict";

const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);

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
    await send({ cmd: "start-select" });
    window.close(); // the drag + results now happen on the page itself
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
  } catch (err) {
    $("err").textContent = String(err?.message || err);
  } finally {
    btn.disabled = false;
  }
});
