#!/usr/bin/env node
// node tests/e2e/extension_smoke.mjs [--extension-dir <path>]; CHROMIUM overrides /usr/bin/chromium.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const DEADLINE_MS = 60_000;

const FIELD_LINES = readFileSync(path.join(REPO_ROOT, "tests", "fixtures", "coa_clean.txt"), "utf8")
  .split("\n")
  .filter((line) => line.includes(":") && !line.startsWith("Notes"));

function parseArgs(argv) {
  let extensionDir = path.join(REPO_ROOT, "extension");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--extension-dir" && argv[i + 1]) extensionDir = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return { extensionDir: realpathSync(path.resolve(extensionDir)) };
}

// Chromium names an unpacked extension after the sha256 of its absolute path, 0-f as a-p.
function extensionIdFor(dir) {
  const hex = createHash("sha256").update(dir).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(what, fn, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      const waiter = msg.id && this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(`${waiter.method}: ${msg.error.message}`));
      else waiter.resolve(msg.result);
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error(`could not connect to ${url}`)), { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }

  async evaluate(sessionId, expression) {
    const { result, exceptionDetails } = await this.send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    }
    return result.value;
  }

  close() {
    try { this.ws.close(); } catch { /* already closed */ }
  }
}

function launchChromium(extensionDir, profileDir) {
  const binary = process.env.CHROMIUM || "/usr/bin/chromium";
  // Without the address flag DevTools binds only to [::1]; without
  // --disable-background-networking Chromium phones GCM on startup.
  const args = [
    "--headless=new", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", `--user-data-dir=${profileDir}`,
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    `--load-extension=${extensionDir}`, `--disable-extensions-except=${extensionDir}`,
    "about:blank",
  ];
  const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  child.stderrTail = () => stderr;
  return child;
}

async function stopChromium(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  if (await Promise.race([exited.then(() => true), sleep(3000).then(() => false)])) return;
  child.kill("SIGKILL");
  await exited;
}

async function openExtensionPage(cdp, url) {
  const { targetId } = await cdp.send("Target.createTarget", { url });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  // A new target starts on about:blank, which is already "complete".
  await waitFor(`${url} to load`, async () => cdp.evaluate(
    sessionId, `location.href === ${JSON.stringify(url)} && document.readyState === "complete"`,
  ));
  return sessionId;
}

async function popupPasteStage(cdp, sessionId) {
  const text = readFileSync(path.join(REPO_ROOT, "tests", "fixtures", "coa_clean.txt"), "utf8");
  await cdp.evaluate(sessionId, `
    document.getElementById("text").value = ${JSON.stringify(text)};
    document.getElementById("analyze").click();
  `);
  const out = await waitFor("the popup to render a result", async () => {
    const r = await cdp.evaluate(sessionId, `({
      result: document.getElementById("result").innerText,
      err: document.getElementById("err").textContent,
    })`);
    return r.result || r.err ? r : null;
  }, 10_000);
  const problems = [];
  if (out.err) problems.push(`popup error: ${out.err}`);
  for (const want of ["4.534 mg", "0 fail, 0 warn, 8 pass (8 checks)"]) {
    if (!out.result.includes(want)) problems.push(`popup result is missing "${want}"`);
  }
  return problems;
}

// Same message background.js sends the offscreen document for a captured screenshot.
async function ocrAt(cdp, sessionId, px, minWidth) {
  return cdp.evaluate(sessionId, `(async () => {
    const lines = ${JSON.stringify(FIELD_LINES)};
    const font = "${px}px sans-serif";
    const pad = Math.ceil(${px} * 0.6);
    const lineHeight = Math.ceil(${px} * 1.5);
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = font;
    const textWidth = Math.max(...lines.map((l) => probe.measureText(l).width));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(${minWidth}, Math.ceil(textWidth + 2 * pad));
    canvas.height = lines.length * lineHeight + 2 * pad;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    ctx.font = font;
    ctx.textBaseline = "top";
    lines.forEach((line, i) => ctx.fillText(line, pad, pad + i * lineHeight));
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: "offscreen/offscreen.html", reasons: ["WORKERS"], justification: "e2e smoke test",
      });
    }
    const resp = await chrome.runtime.sendMessage({
      target: "coacheck-offscreen", cmd: "recognize", dataUrl: canvas.toDataURL("image/png"),
      rect: { left: 0, top: 0, width: canvas.width, height: canvas.height }, dpr: 1,
    });
    if (!resp || !resp.ok) throw new Error(resp?.error || "no response from the offscreen document");
    return resp.text;
  })()`);
}

const OCR_CASES = [
  { px: 28, minWidth: 330, want: { purity_pct: 99.1, mass_mg: 5 } },
];

async function ocrStage(cdp, sessionId, parseCoa) {
  const problems = [];
  for (const { px, minWidth, want } of OCR_CASES) {
    const text = await ocrAt(cdp, sessionId, px, minWidth);
    const coa = parseCoa(text);
    for (const [field, value] of Object.entries(want)) {
      if (coa[field] !== value) {
        problems.push(`OCR at ${px} px: ${field} is ${JSON.stringify(coa[field])}, wanted ${JSON.stringify(value)}`);
      }
    }
    if (problems.length) problems.push(`OCR text at ${px} px:\n${text}`);
  }
  return problems;
}

async function main() {
  const started = Date.now();
  const { extensionDir } = parseArgs(process.argv.slice(2));
  if (!existsSync(path.join(extensionDir, "manifest.json"))) {
    throw new Error(`no manifest.json in ${extensionDir}`);
  }
  const extensionId = extensionIdFor(extensionDir);
  const { parseCoa } = await import(pathToFileURL(path.join(extensionDir, "engine", "parser.js")));

  const profileDir = mkdtempSync(path.join(tmpdir(), "coacheck-e2e-"));
  const chromium = launchChromium(extensionDir, profileDir);
  let cdp = null;
  const cleanup = async () => {
    cdp?.close();
    await stopChromium(chromium);
    rmSync(profileDir, { recursive: true, force: true });
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => cleanup().finally(() => process.exit(130)));
  }
  // Last resort for an uncaught error or a closed stdout, where the async cleanup never runs.
  process.once("exit", () => {
    if (chromium.exitCode === null && chromium.signalCode === null) chromium.kill("SIGKILL");
    rmSync(profileDir, { recursive: true, force: true });
  });
  const watchdog = setTimeout(() => {
    console.error(`FAIL  gave up after ${DEADLINE_MS / 1000} s`);
    cleanup().finally(() => process.exit(1));
  }, DEADLINE_MS);

  const problems = [];
  try {
    chromium.once("exit", (code, signal) => {
      if (!cdp) console.error(`chromium exited early (${code ?? signal}):\n${chromium.stderrTail()}`);
    });
    const portFile = path.join(profileDir, "DevToolsActivePort");
    const port = await waitFor("chromium's DevTools port", () =>
      existsSync(portFile) && readFileSync(portFile, "utf8").split("\n")[0]);
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    cdp = await Cdp.connect(version.webSocketDebuggerUrl);

    const workerUrl = `chrome-extension://${extensionId}/background.js`;
    await waitFor("the extension's service worker", async () => {
      const { targetInfos } = await cdp.send("Target.getTargets");
      return targetInfos.some((t) => t.type === "service_worker" && t.url === workerUrl);
    }, 10_000);

    const popup = await openExtensionPage(cdp, `chrome-extension://${extensionId}/popup/popup.html`);
    const stage1 = await popupPasteStage(cdp, popup);
    console.log(`${stage1.length ? "FAIL" : "ok  "}  popup paste path through background.js`);
    problems.push(...stage1);

    const stage2 = await ocrStage(cdp, popup, parseCoa);
    console.log(`${stage2.length ? "FAIL" : "ok  "}  offscreen OCR (${OCR_CASES.map((c) => `${c.px} px`).join(", ")})`);
    problems.push(...stage2);
  } catch (err) {
    problems.push(String(err?.stack || err));
  } finally {
    clearTimeout(watchdog);
    await cleanup();
  }

  for (const p of problems) console.error(p);
  console.log(`\n${problems.length ? "FAILED" : "passed"} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
