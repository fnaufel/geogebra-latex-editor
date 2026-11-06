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
        <p id="selection-state" role="status" aria-live="polite">Select one text object in GeoGebra, then choose Edit selected text.</p>
        <div class="editor-actions">
          <button id="edit-selected" type="button" disabled>Edit selected text</button>
          <button id="adopt" type="button" hidden>Adopt text</button>
          <button id="insert-object" type="button" disabled>Insert Object</button>
          <button id="cancel-insertion" type="button" hidden>Cancel insertion</button>
          <button id="apply" type="button" disabled>Apply</button>
          <button id="reapply" type="button" hidden>Reapply Draft</button>
          <button id="discard-draft" type="button" hidden>Discard Draft</button>
          <button id="recover-failed-apply" type="button" hidden disabled>Restore failed Apply draft</button>
        </div>
        <p id="applied-source-label" hidden>Applied Source:</p>
        <pre id="applied-source" hidden></pre>
        <p id="interaction-state" role="status" aria-live="polite"></p>
      </div>
      <div id="editor" class="editor-host" aria-label="Authoring Source editor"></div>
      <pre id="unmanaged-source" role="region" aria-label="Rendered LaTeX snapshot" hidden></pre>
      <pre id="retained-draft" role="region" aria-label="Draft Source retained after undo" hidden></pre>
      <div id="editor-feedback" class="editor-feedback">
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
const unmanagedSource = required<HTMLElement>("#unmanaged-source");
const retainedDraft = required<HTMLElement>("#retained-draft");
const editorFeedback = required<HTMLElement>("#editor-feedback");
const simplifyInput = required<HTMLInputElement>("#simplify");
const newManagedText = required<HTMLButtonElement>("#new-managed-text");
const openFile = required<HTMLButtonElement>("#open-file");
const fileInput = required<HTMLInputElement>("#file-input");
const downloadFile = required<HTMLButtonElement>("#download-file");
const filename = required<HTMLElement>("#filename");
const targetLabel = required<HTMLElement>("#target-label");
const targetState = required<HTMLElement>("#target-state");
const selectionState = required<HTMLElement>("#selection-state");
const interactionState = required<HTMLElement>("#interaction-state");
const editSelected = required<HTMLButtonElement>("#edit-selected");
const adoptButton = required<HTMLButtonElement>("#adopt");
const insertObject = required<HTMLButtonElement>("#insert-object");
const cancelInsertion = required<HTMLButtonElement>("#cancel-insertion");
const applyButton = required<HTMLButtonElement>("#apply");
const reapplyButton = required<HTMLButtonElement>("#reapply");
const discardDraftButton = required<HTMLButtonElement>("#discard-draft");
const recoverFailedApplyButton = required<HTMLButtonElement>(
  "#recover-failed-apply",
);
const appliedSourceLabel = required<HTMLElement>("#applied-source-label");
const appliedSource = required<HTMLElement>("#applied-source");
let refreshSymbols = () => {};
let insertionActive = false;

function renderAppletState(state: AppletState): void {
  const ready = state.kind === "ready";
  newManagedText.disabled = !ready;
  openFile.disabled = !ready;
  downloadFile.disabled = !ready;
  recoverFailedApplyButton.disabled = !ready;
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
  simplifyInput,
  required<HTMLButtonElement>("#copy-definition"),
  adapter,
  ({
    target,
    unmanaged,
    retainedDraftSource,
    hasDraft,
    diverged,
    canApply,
    canEditSelection,
    selectionMessage,
    insertionMode,
    interactionMessage,
    actionError,
    recoveryAvailable,
  }) => {
    targetLabel.textContent = target
      ? `Editing Target: ${target.targetLabel}`
      : unmanaged
        ? `Editing Target: ${unmanaged.label}`
        : "No Editing Target";
    targetState.textContent =
      actionError ??
      (unmanaged
        ? retainedDraftSource !== null
          ? "Unmanaged Text Object. Draft Source from undone Adoption is retained below. Redo or adopt again to edit it."
          : "Unmanaged Text Object. This is a read-only snapshot of its current rendered LaTeX. Adopt to create Authoring Source."
        : target
          ? hasDraft
            ? diverged
              ? "Diverged Draft: Applied Source changed in GeoGebra. Reapply or discard this draft."
              : "Draft Source has unapplied changes."
            : "Applied Source is current."
          : recoveryAvailable
            ? "A failed Apply snapshot and Draft Source are available to restore."
            : "No text is open for editing.");
    applyButton.disabled = !target || !hasDraft || !canApply;
    adoptButton.hidden = !unmanaged;
    unmanagedSource.hidden = !unmanaged;
    unmanagedSource.textContent = unmanaged?.renderedLatex ?? "";
    retainedDraft.hidden = retainedDraftSource === null;
    retainedDraft.textContent = retainedDraftSource ?? "";
    editorHost.hidden = !!unmanaged;
    editorFeedback.hidden = !!unmanaged;
    simplifyInput.disabled = !!unmanaged;
    applyButton.hidden = diverged;
    reapplyButton.hidden = !diverged;
    reapplyButton.disabled = !canApply;
    discardDraftButton.hidden = !diverged;
    recoverFailedApplyButton.hidden = !recoveryAvailable;
    appliedSourceLabel.hidden = !diverged;
    appliedSource.hidden = !diverged;
    appliedSource.textContent = diverged ? (target?.source ?? "") : "";
    selectionState.textContent = selectionMessage;
    interactionState.textContent = interactionMessage;
    editSelected.disabled = !canEditSelection || adapter.state.kind !== "ready";
    insertObject.disabled =
      !target || insertionMode || adapter.state.kind !== "ready";
    cancelInsertion.hidden = !insertionMode;
    insertionActive = insertionMode;
  },
);
refreshSymbols = authoring.refreshSymbols;

function reportActionError(error: unknown): Promise<void> {
  return authoring.reportActionError(error);
}

newManagedText.addEventListener("click", () => {
  authoring.clearActionError();
  void authoring.create().catch(reportActionError);
});
editSelected.addEventListener("click", () => {
  if (authoring.editSelectedText() && !adoptButton.hidden) adoptButton.focus();
});
adoptButton.addEventListener("click", () => {
  if (
    !window.confirm(
      "Adopt this Unmanaged Text Object? Authoring Source will be only a literal snapshot of the current rendered LaTeX. Original dynamic dependencies cannot be reconstructed.",
    )
  ) {
    adoptButton.focus();
    return;
  }
  void authoring.adopt().catch(reportActionError);
});
insertObject.addEventListener("click", () => authoring.startInsertion());
cancelInsertion.addEventListener("click", () => authoring.cancelInsertion());
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !insertionActive) return;
  event.preventDefault();
  authoring.cancelInsertion();
});
function applyDraft(): void {
  void authoring.apply().catch(reportActionError);
}
applyButton.addEventListener("click", applyDraft);
reapplyButton.addEventListener("click", applyDraft);
discardDraftButton.addEventListener("click", () => {
  authoring.discardDraft();
});
recoverFailedApplyButton.addEventListener("click", () => {
  if (
    !window.confirm(
      "Restore the construction and Draft Source from the failed Apply? Current construction changes will be replaced.",
    )
  )
    return;
  void authoring.recoverFailedApply().catch(reportActionError);
});
openFile.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  void (async () => {
    if (
      authoring.hasAnyDraft() &&
      !window.confirm(
        "Discard unapplied Draft Source and open another construction?",
      )
    )
      return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    authoring.clearActionError();
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
      authoring.hasAnyDraft() &&
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
