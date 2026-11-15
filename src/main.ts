import "./style.css";
import {
  configureCheck,
  diagnosticPrompt,
  firebaseProjectId,
  runDiagnostic,
} from "./firebase";
import { mountWorkspace } from "./workspace-ui";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header><a href="#" aria-label="KDBDocs home"><span class="brand-mark" aria-hidden="true">K</span>KDBDocs</a></header>
  <main>
  <section id="library"></section>
  <details class="diagnostics" id="diagnostics"><summary>Connection diagnostics</summary><div class="grid"><section class="panel"><h2>Firebase diagnostic</h2><p>Real connectivity checks, using a fixed, non-sensitive prompt.</p>
  <dl><dt>Project</dt><dd id="firebase-project"></dd><dt>Browser</dt><dd id="browser"></dd><dt>Secure context</dt><dd id="secure"></dd><dt>Local model</dt><dd id="availability">Not checked</dd></dl>
  <div class="actions"><button id="inspect">Check device</button><button id="local">Run local-only test</button></div>
  <p class="note">The local test may download a browser model. Generic Firebase/service traffic can still occur. Document content never falls back to cloud.</p>
  <details><summary>Optional cloud diagnostic</summary><p>Only the exact prompt below will be sent through Firebase AI Logic to the Gemini Developer API. No imported file data is included.</p><blockquote id="prompt"></blockquote><label><input type="checkbox" id="consent"> Allow this diagnostic prompt to be sent when I run the cloud test</label><div class="actions"><button id="check">Check App Check</button><button id="cloud" disabled>Run cloud-only test</button></div><p class="note">Uncheck to revoke future diagnostic requests. Requests already sent cannot be recalled. Console setup may be required; see README.</p></details>
  <pre id="result" role="status" aria-live="polite">No inference has run.</pre></section></div></details>
  </main>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
mountWorkspace(el("library"));
// Developer tool (App Check debug token, raw model checks): open with ?diagnostics.
el("diagnostics").hidden = !new URLSearchParams(location.search).has(
  "diagnostics",
);
const show = (text: string) => {
  el("result").textContent = text;
};
el("prompt").textContent = diagnosticPrompt;
el("firebase-project").textContent =
  firebaseProjectId || "Not configured: copy .env.example to .env.local";
el("browser").textContent = navigator.userAgent;
el("secure").textContent = isSecureContext
  ? "Yes"
  : "No — use localhost or HTTPS";
async function inspectDevice() {
  try {
    const api = (
      globalThis as unknown as {
        LanguageModel?: { availability: () => Promise<string> };
      }
    ).LanguageModel;
    el("availability").textContent = api
      ? await api.availability()
      : "Prompt API absent. Use desktop Chrome 139+ and enable the documented Prompt API flag.";
  } catch {
    el("availability").textContent =
      "Availability check failed. Local inference remains unverified.";
  }
}
el("inspect").onclick = () => void inspectDevice();
const consent = el<HTMLInputElement>("consent");
consent.onchange = () => {
  el<HTMLButtonElement>("cloud").disabled = busy || !consent.checked;
};
let busy = false;
async function run(route: "local" | "cloud") {
  if (busy) return;
  busy = true;
  ["local", "cloud", "check"].forEach(
    (id) => (el<HTMLButtonElement>(id).disabled = true),
  );
  try {
    const start = performance.now();
    const result = await runDiagnostic(route, () => consent.checked, show);
    show(
      `Completed in ${((performance.now() - start) / 1000).toFixed(1)}s\nRequested: ${route}-only\nReported source: ${result.source}\n\n${result.text}`,
    );
    if (route === "local") await inspectDevice();
  } catch (error) {
    show(
      `Test failed; inference is not verified. No fallback was attempted.\n${error instanceof Error ? error.message : "Unknown error"}\nSee README for browser and Firebase setup.`,
    );
  } finally {
    busy = false;
    ["local", "check"].forEach(
      (id) => (el<HTMLButtonElement>(id).disabled = false),
    );
    el<HTMLButtonElement>("cloud").disabled = !consent.checked;
  }
}
el("local").onclick = () => void run("local");
el("cloud").onclick = () => void run("cloud");
el("check").onclick = async () => {
  if (busy) return;
  busy = true;
  ["local", "cloud", "check"].forEach(
    (id) => (el<HTMLButtonElement>(id).disabled = true),
  );
  try {
    await configureCheck();
    show("App Check token obtained. Cloud inference has not been tested.");
  } catch (error) {
    show(
      `App Check not verified: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  } finally {
    busy = false;
    ["local", "check"].forEach(
      (id) => (el<HTMLButtonElement>(id).disabled = false),
    );
    el<HTMLButtonElement>("cloud").disabled = !consent.checked;
  }
};
