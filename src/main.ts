import { mountAuthoringEditor } from "./editor";
import { AppletState, GeoGebraAdapter, GEOGEBRA_VERSION } from "./geogebra";
import "./style.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Application mount point is missing.");
const mount = root;

root.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">∑</span>
      <div>
        <h1>LaTeX Text Editor for GeoGebra</h1>
        <p>Construction workspace</p>
      </div>
    </div>
    <span class="pin">GeoGebra Classic ${GEOGEBRA_VERSION}</span>
    <div class="file-actions">
      <button id="new-managed-text" type="button" disabled>New Managed Text</button>
      <button id="open-file" type="button" disabled>Open .ggb</button>
      <input id="file-input" type="file" accept=".ggb,application/vnd.geogebra.file" hidden>
      <button id="download-file" type="button" disabled>Download .ggb</button>
      <span id="filename">construction.ggb</span>
    </div>
  </header>
  <main class="workspace" aria-label="Construction and authoring workspace">
    <section class="pane construction-pane" aria-labelledby="construction-heading">
      <div class="pane-heading"><h2 id="construction-heading">Construction</h2><p id="applet-state" role="status" aria-label="Applet status" aria-live="polite">Loading GeoGebra…</p></div>
      <div class="applet-stage">
        <div id="ggb-element" aria-label="GeoGebra Classic construction"></div>
        <div class="applet-notice" id="applet-notice">
          <div class="notice-card">
            <span class="loader" id="loading-mark" aria-hidden="true"></span>
            <p id="notice-text">Loading GeoGebra…</p>
            <button id="retry" type="button" hidden>Retry GeoGebra</button>
          </div>
        </div>
      </div>
    </section>
    <div id="splitter" class="splitter" role="separator" tabindex="0" aria-label="Resize construction and editor panes" aria-orientation="vertical" aria-valuemin="20" aria-valuemax="80" aria-valuenow="52" aria-valuetext="Construction pane 52 percent"></div>
    <section class="pane editor-pane" aria-labelledby="editor-heading">
      <div class="pane-heading"><h2 id="editor-heading">Authoring Source</h2></div>
      <div class="editor-intro">
        <strong id="target-label">No Editing Target</strong>
        <p id="target-state">No text is open for editing.</p>
        <button id="apply" type="button" disabled>Apply</button>
      </div>
      <div id="editor" class="editor-host" aria-label="Authoring Source editor"></div>
      <div class="editor-feedback">
        <label class="simplify-control"><input id="simplify" type="checkbox" checked>Clean signs and 1x coefficients</label>
        <p class="simplify-help">GeoGebra rewrites the complete text without understanding LaTeX. For example, \\text{C++} can become \\text{C + }, and \\text{--} can become \\text{ + }.</p>
        <h3>Diagnostics</h3>
        <div id="diagnostics" aria-live="polite"></div>
        <details class="advanced"><summary>Advanced</summary><p>Compiled Definition</p><pre id="compiled-definition" aria-label="Compiled Definition"></pre><button id="copy-definition" type="button">Copy definition</button></details>
      </div>
    </section>
  </main>
  <footer class="footer">
    <span>Unofficial · Made with GeoGebra®</span>
    <nav aria-label="Project and GeoGebra information">
      <a href="https://github.com/fnaufel/geogebra-latex-editor">Project source</a>
      <a href="https://www.geogebra.org/license">GeoGebra license</a>
      <a href="https://www.geogebra.org/tos">GeoGebra terms</a>
    </nav>
  </footer>
`;

function required<T extends Element>(selector: string): T {
  const element = mount.querySelector<T>(selector);
  if (!element) throw new Error(`Missing application element: ${selector}`);
  return element;
}

const workspace = required<HTMLElement>(".workspace");
const appletElement = required<HTMLElement>("#ggb-element");
const notice = required<HTMLElement>("#applet-notice");
const status = required<HTMLElement>("#applet-state");
const noticeText = required<HTMLElement>("#notice-text");
const loadingMark = required<HTMLElement>("#loading-mark");
const retry = required<HTMLButtonElement>("#retry");
const splitter = required<HTMLElement>("#splitter");
const editorHost = required<HTMLElement>("#editor");
const newManagedText = required<HTMLButtonElement>("#new-managed-text");
const openFile = required<HTMLButtonElement>("#open-file");
const fileInput = required<HTMLInputElement>("#file-input");
const downloadFile = required<HTMLButtonElement>("#download-file");
const filename = required<HTMLElement>("#filename");
const targetLabel = required<HTMLElement>("#target-label");
const targetState = required<HTMLElement>("#target-state");
const applyButton = required<HTMLButtonElement>("#apply");
let refreshSymbols = () => {};

function renderAppletState(state: AppletState): void {
  const ready = state.kind === "ready";
  newManagedText.disabled = !ready;
  openFile.disabled = !ready;
  downloadFile.disabled = !ready;
  notice.hidden = state.kind === "ready";
  retry.hidden =
    state.kind === "idle" || state.kind === "loading" || state.kind === "ready";
  loadingMark.hidden = state.kind !== "loading";
  switch (state.kind) {
    case "idle":
    case "loading":
      status.textContent = "Loading GeoGebra…";
      break;
    case "ready":
      status.textContent = `GeoGebra ready (${state.version}).`;
      queueMicrotask(refreshSymbols);
      break;
    case "version-mismatch":
      status.textContent = `Version mismatch: expected ${GEOGEBRA_VERSION}, received ${state.actual}.`;
      break;
    case "error":
      status.textContent = `GeoGebra initialization failed: ${state.message}`;
      break;
  }
  noticeText.textContent = status.textContent;
}

const adapter = new GeoGebraAdapter(appletElement, renderAppletState);
const authoring = mountAuthoringEditor(
  editorHost,
  required<HTMLElement>("#diagnostics"),
  required<HTMLElement>("#compiled-definition"),
  required<HTMLInputElement>("#simplify"),
  required<HTMLButtonElement>("#copy-definition"),
  adapter,
  (target, hasDraft) => {
    targetLabel.textContent = target
      ? `Editing Target: ${target.targetLabel}`
      : "No Editing Target";
    targetState.textContent = target
      ? hasDraft
        ? "Draft Source has unapplied changes."
        : "Applied Source is current."
      : "No text is open for editing.";
    applyButton.disabled = !target || !hasDraft;
  },
);
refreshSymbols = authoring.refreshSymbols;

function reportActionError(error: unknown): void {
  targetState.textContent =
    error instanceof Error ? error.message : "GeoGebra action failed.";
}

newManagedText.addEventListener("click", () => {
  void authoring.create().catch(reportActionError);
});
applyButton.addEventListener("click", () => {
  void authoring.apply().catch(reportActionError);
});
openFile.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  void (async () => {
    if (
      authoring.hasDraft() &&
      !window.confirm(
        "Discard unapplied Draft Source and open another construction?",
      )
    )
      return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    await authoring.open(btoa(binary));
    filename.textContent = file.name.replace(/\.ggb$/i, "") + "-edited.ggb";
    refreshSymbols();
  })()
    .catch(reportActionError)
    .finally(() => {
      fileInput.value = "";
    });
});
downloadFile.addEventListener("click", () => {
  void (async () => {
    if (
      authoring.hasDraft() &&
      !window.confirm(
        "Download Applied State only? Unapplied Draft Source will stay in the editor.",
      )
    )
      return;
    const base64 = await authoring.exportBase64();
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/vnd.geogebra.file" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.textContent || "construction.ggb";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  })().catch(reportActionError);
});
retry.addEventListener("click", () => void adapter.retry());
new ResizeObserver(() => adapter.resize()).observe(
  required<HTMLElement>(".applet-stage"),
);

let split = 52;
const narrow = window.matchMedia("(max-width: 700px)");

function updateLayout(): void {
  workspace.classList.toggle("stacked", narrow.matches);
  splitter.setAttribute(
    "aria-orientation",
    narrow.matches ? "horizontal" : "vertical",
  );
}

function setSplit(value: number): void {
  split = Math.max(20, Math.min(80, Math.round(value)));
  workspace.style.setProperty("--split", `${split}%`);
  splitter.setAttribute("aria-valuenow", String(split));
  splitter.setAttribute("aria-valuetext", `Construction pane ${split} percent`);
  adapter.resize();
}

splitter.addEventListener("keydown", (event) => {
  const delta =
    event.key === "ArrowLeft" || event.key === "ArrowUp"
      ? -2
      : event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 2
        : 0;
  if (delta) setSplit(split + delta);
  else if (event.key === "Home") setSplit(20);
  else if (event.key === "End") setSplit(80);
  else return;
  event.preventDefault();
});

splitter.addEventListener("pointerdown", (event) => {
  splitter.setPointerCapture(event.pointerId);
  splitter.classList.add("dragging");
});
splitter.addEventListener("pointermove", (event) => {
  if (!splitter.hasPointerCapture(event.pointerId)) return;
  const bounds = workspace.getBoundingClientRect();
  const value = narrow.matches
    ? ((event.clientY - bounds.top) / bounds.height) * 100
    : ((event.clientX - bounds.left) / bounds.width) * 100;
  setSplit(value);
});
splitter.addEventListener("pointerup", (event) => {
  splitter.releasePointerCapture(event.pointerId);
  splitter.classList.remove("dragging");
});
splitter.addEventListener("pointercancel", () =>
  splitter.classList.remove("dragging"),
);
narrow.addEventListener("change", updateLayout);
updateLayout();
renderAppletState(adapter.state);
void adapter.start();
