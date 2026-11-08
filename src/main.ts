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
      <button id="new-construction" type="button" disabled>New construction</button>
      <button id="new-managed-text" type="button" disabled>New Managed Text</button>
      <button id="open-file" type="button" disabled>Open .ggb</button>
      <input id="file-input" type="file" accept=".ggb,application/vnd.geogebra.file" hidden>
      <button id="download-file" type="button" disabled>Download .ggb</button>
      <button id="download-original-metadata" type="button" hidden>Download original metadata</button>
      <span id="filename">construction.ggb</span>
      <span id="construction-state" role="status" aria-live="polite">Construction current</span>
      <button id="local-recovery" type="button">Local recovery (0)</button>
      <span id="recovery-status" role="status" aria-live="polite"></span>
      <span id="concurrent-warning" role="status" aria-live="polite" hidden></span>
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
          <button id="restore-orphaned" type="button" hidden>Restore Orphaned Source as new text</button>
          <button id="discard-orphaned" type="button" hidden>Discard Orphaned Source</button>
          <button id="insert-object" type="button" disabled>Insert Object</button>
          <button id="cancel-insertion" type="button" hidden>Cancel insertion</button>
          <button id="apply" type="button" disabled>Apply</button>
          <button id="reapply" type="button" hidden>Reapply Draft</button>
          <button id="discard-draft" type="button" hidden>Discard Draft</button>
          <button id="recover-failed-apply" type="button" hidden disabled>Restore failed Apply draft</button>
        </div>
        <div id="orphaned-sources" role="group" aria-label="Other Orphaned Sources" hidden></div>
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
  <dialog id="download-dialog" aria-labelledby="download-title">
    <h2 id="download-title">Download construction</h2>
    <p>Draft Sources remain local until applied. Downloading the applied construction does not save them in the file.</p>
    <p>Apply all valid drafts skips invalid and divergent drafts; they remain in this workspace.</p>
    <div id="download-drafts" role="status"></div>
    <fieldset id="download-choices">
      <legend>Download choice</legend>
      <label><input type="radio" name="download-choice" value="apply"> Apply all valid drafts</label>
      <label><input type="radio" name="download-choice" value="applied" checked> Download applied construction only</label>
    </fieldset>
    <label>Filename <input id="download-name" type="text" required></label>
    <div class="dialog-actions">
      <button id="cancel-download" type="button">Cancel</button>
      <button id="confirm-download" type="button">Download .ggb</button>
    </div>
  </dialog>
  <dialog id="recovery-dialog" aria-labelledby="recovery-title">
    <h2 id="recovery-title">Local recovery</h2>
    <p>Recovery stays in this browser. Review each entry before restoring its construction snapshot and Draft Sources.</p>
    <div id="recovery-entries"></div>
    <div class="dialog-actions">
      <button id="clear-local-recovery" type="button">Clear local recovery data</button>
      <button id="close-recovery" type="button">Close</button>
    </div>
  </dialog>
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
const newConstruction = required<HTMLButtonElement>("#new-construction");
const newManagedText = required<HTMLButtonElement>("#new-managed-text");
const openFile = required<HTMLButtonElement>("#open-file");
const fileInput = required<HTMLInputElement>("#file-input");
const downloadFile = required<HTMLButtonElement>("#download-file");
const downloadOriginalMetadata = required<HTMLButtonElement>(
  "#download-original-metadata",
);
const filename = required<HTMLElement>("#filename");
const constructionState = required<HTMLElement>("#construction-state");
const localRecovery = required<HTMLButtonElement>("#local-recovery");
const recoveryStatus = required<HTMLElement>("#recovery-status");
const concurrentWarning = required<HTMLElement>("#concurrent-warning");
const recoveryDialog = required<HTMLDialogElement>("#recovery-dialog");
const recoveryEntries = required<HTMLElement>("#recovery-entries");
const clearLocalRecovery = required<HTMLButtonElement>("#clear-local-recovery");
const closeRecovery = required<HTMLButtonElement>("#close-recovery");
const downloadDialog = required<HTMLDialogElement>("#download-dialog");
const downloadDrafts = required<HTMLElement>("#download-drafts");
const downloadName = required<HTMLInputElement>("#download-name");
const cancelDownload = required<HTMLButtonElement>("#cancel-download");
const confirmDownload = required<HTMLButtonElement>("#confirm-download");
const targetLabel = required<HTMLElement>("#target-label");
const targetState = required<HTMLElement>("#target-state");
const selectionState = required<HTMLElement>("#selection-state");
const interactionState = required<HTMLElement>("#interaction-state");
const editSelected = required<HTMLButtonElement>("#edit-selected");
const adoptButton = required<HTMLButtonElement>("#adopt");
const restoreOrphanedButton = required<HTMLButtonElement>("#restore-orphaned");
const discardOrphanedButton = required<HTMLButtonElement>("#discard-orphaned");
const orphanedSources = required<HTMLElement>("#orphaned-sources");
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
let fileOperationBusy = false;

function renderAppletState(state: AppletState): void {
  const ready = state.kind === "ready" && !fileOperationBusy;
  newConstruction.disabled = !ready;
  newManagedText.disabled = !ready;
  openFile.disabled = !ready;
  downloadFile.disabled = !ready;
  downloadOriginalMetadata.hidden = !adapter.recoverableOlderMetadataBytes;
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
    orphaned,
    availableOrphans,
    canRestoreOrphaned,
    retainedDraftSource,
    hasDraft,
    dirtyConstruction,
    diverged,
    canApply,
    canEditSelection,
    selectionMessage,
    insertionMode,
    interactionMessage,
    actionError,
    recoveryAvailable,
    recoveryCandidates,
    concurrentTabWarning,
  }) => {
    targetLabel.textContent = target
      ? `Editing Target: ${target.targetLabel}`
      : unmanaged
        ? `Editing Target: ${unmanaged.label}`
        : orphaned
          ? `Orphaned Source: ${orphaned.targetLabel}`
          : "No Editing Target";
    targetState.textContent =
      actionError ??
      (orphaned
        ? orphaned.candidates.length
          ? `Orphaned Source. Multiple possible targets (${orphaned.candidates.join(", ")}); choose a new target or resolve the uncertainty manually.`
          : canRestoreOrphaned
            ? "Orphaned Source is retained. Edit it if needed, then restore it as a new Managed Text Object."
            : "Orphaned Source is retained in this tab. Its metadata is unavailable; copy the source or discard it."
        : unmanaged
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
    applyButton.disabled =
      fileOperationBusy || !target || !hasDraft || !canApply;
    adoptButton.hidden = !unmanaged;
    adoptButton.disabled = fileOperationBusy;
    restoreOrphanedButton.hidden = !orphaned;
    restoreOrphanedButton.disabled =
      fileOperationBusy ||
      !canRestoreOrphaned ||
      !canApply ||
      adapter.state.kind !== "ready";
    discardOrphanedButton.hidden = !orphaned;
    discardOrphanedButton.disabled = fileOperationBusy;
    orphanedSources.replaceChildren();
    for (const source of availableOrphans) {
      if (source.id === orphaned?.id) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Open Orphaned Source: ${source.targetLabel}`;
      button.addEventListener("click", () => authoring.openOrphaned(source.id));
      orphanedSources.append(button);
    }
    orphanedSources.hidden = orphanedSources.childElementCount === 0;
    unmanagedSource.hidden = !unmanaged;
    unmanagedSource.textContent = unmanaged?.renderedLatex ?? "";
    retainedDraft.hidden = retainedDraftSource === null;
    retainedDraft.textContent = retainedDraftSource ?? "";
    editorHost.hidden = !!unmanaged;
    editorFeedback.hidden = !!unmanaged;
    simplifyInput.disabled = fileOperationBusy || !!unmanaged;
    applyButton.hidden = diverged;
    reapplyButton.hidden = !diverged;
    reapplyButton.disabled = fileOperationBusy || !canApply;
    discardDraftButton.hidden = !diverged;
    discardDraftButton.disabled = fileOperationBusy;
    recoverFailedApplyButton.hidden = !recoveryAvailable;
    appliedSourceLabel.hidden = !diverged;
    appliedSource.hidden = !diverged;
    appliedSource.textContent = diverged ? (target?.source ?? "") : "";
    selectionState.textContent = selectionMessage;
    interactionState.textContent = interactionMessage;
    constructionState.textContent = dirtyConstruction
      ? "Dirty Construction · changes since last open or download"
      : "Construction current";
    localRecovery.textContent = `Local recovery (${recoveryCandidates.length})`;
    recoveryStatus.textContent = recoveryCandidates.length
      ? `${recoveryCandidates.length} local Recovery Draft ${recoveryCandidates.length === 1 ? "entry is" : "entries are"} available.`
      : "";
    concurrentWarning.hidden = !concurrentTabWarning;
    concurrentWarning.textContent = concurrentTabWarning
      ? "Another tab has this construction open. Tabs remain independent; review changes before downloading."
      : "";
    editSelected.disabled =
      fileOperationBusy || !canEditSelection || adapter.state.kind !== "ready";
    insertObject.disabled =
      fileOperationBusy ||
      !target ||
      insertionMode ||
      adapter.state.kind !== "ready";
    cancelInsertion.hidden = !insertionMode;
    insertionActive = insertionMode;
  },
);
refreshSymbols = authoring.refreshSymbols;
editorHost.addEventListener(
  "beforeinput",
  (event) => {
    if (fileOperationBusy) event.preventDefault();
  },
  true,
);

function setFileOperationBusy(busy: boolean): void {
  fileOperationBusy = busy;
  renderAppletState(adapter.state);
  confirmDownload.disabled = busy;
  cancelDownload.disabled = busy;
  if (busy) {
    for (const button of [
      applyButton,
      reapplyButton,
      editSelected,
      adoptButton,
      restoreOrphanedButton,
      discardOrphanedButton,
      discardDraftButton,
      insertObject,
    ])
      button.disabled = true;
    simplifyInput.disabled = true;
  } else authoring.refreshSymbols();
}

function reportActionError(error: unknown): Promise<void> {
  return authoring.reportActionError(error);
}

function confirmReplacement(action: "New" | "Open"): boolean {
  if (
    authoring.hasAnyDraft() &&
    !window.confirm(
      `${action} will discard unapplied Draft Sources. Downloading the construction does not save these drafts. Continue?`,
    )
  )
    return false;
  if (
    authoring.dirtyConstruction() &&
    !window.confirm(
      `${action} will discard Dirty Construction changes since the last open or download. Applying Draft Sources does not download the construction. Continue?`,
    )
  )
    return false;
  return true;
}

newConstruction.addEventListener("click", () => {
  if (fileOperationBusy) return;
  if (!confirmReplacement("New")) return;
  setFileOperationBusy(true);
  void (async () => {
    try {
      await authoring.newConstruction();
      filename.textContent = "construction.ggb";
      refreshSymbols();
    } finally {
      setFileOperationBusy(false);
      newConstruction.focus();
    }
  })().catch(reportActionError);
});

newManagedText.addEventListener("click", () => {
  if (fileOperationBusy) return;
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
restoreOrphanedButton.addEventListener("click", () => {
  void authoring.restoreOrphaned().catch(reportActionError);
});
discardOrphanedButton.addEventListener("click", () => {
  if (!window.confirm("Discard this Orphaned Source and its Draft Source?"))
    return;
  void authoring.discardOrphaned().catch(reportActionError);
});
insertObject.addEventListener("click", () => authoring.startInsertion());
cancelInsertion.addEventListener("click", () => authoring.cancelInsertion());
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !insertionActive) return;
  event.preventDefault();
  authoring.cancelInsertion();
});
function applyDraft(): void {
  if (fileOperationBusy) return;
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
  if (fileOperationBusy) return;
  const file = fileInput.files?.[0];
  if (!file) return;
  void (async () => {
    if (!confirmReplacement("Open")) return;
    setFileOperationBusy(true);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    authoring.clearActionError();
    await authoring.open(btoa(binary));
    downloadOriginalMetadata.hidden = !adapter.recoverableOlderMetadataBytes;
    filename.textContent = file.name.replace(/\.ggb$/i, "") + "-edited.ggb";
    refreshSymbols();
  })()
    .catch(reportActionError)
    .finally(() => {
      setFileOperationBusy(false);
      fileInput.value = "";
    });
});
downloadFile.addEventListener("click", () => {
  if (fileOperationBusy) return;
  downloadDrafts.replaceChildren();
  const drafts = authoring.draftDetails();
  if (drafts.length === 0)
    downloadDrafts.textContent = "No unapplied Draft Sources.";
  else {
    const list = document.createElement("ul");
    for (const draft of drafts) {
      const item = document.createElement("li");
      item.textContent = `${draft.label}: ${draft.kind} Draft Source. ${draft.reason}`;
      list.append(item);
    }
    downloadDrafts.append(list);
  }
  const applyChoice = required<HTMLInputElement>(
    'input[name="download-choice"][value="apply"]',
  );
  applyChoice.disabled = drafts.length === 0;
  required<HTMLInputElement>(
    'input[name="download-choice"][value="applied"]',
  ).checked = true;
  downloadName.value = filename.textContent || "construction.ggb";
  downloadDialog.showModal();
});
cancelDownload.addEventListener("click", () => downloadDialog.close());
downloadDialog.addEventListener("close", () => downloadFile.focus());
confirmDownload.addEventListener("click", () => {
  if (fileOperationBusy) return;
  downloadName.setCustomValidity(
    downloadName.value.trim() ? "" : "Enter a filename.",
  );
  if (!downloadName.reportValidity()) return;
  setFileOperationBusy(true);
  void (async () => {
    const choice = required<HTMLInputElement>(
      'input[name="download-choice"][value="apply"]',
    );
    if (choice.checked) await authoring.applyAllValidDrafts();
    const base64 = await authoring.exportBase64();
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/vnd.geogebra.file" }),
    );
    const link = document.createElement("a");
    link.href = url;
    const chosen = downloadName.value.trim();
    link.download = /\.ggb$/i.test(chosen) ? chosen : `${chosen}.ggb`;
    link.click();
    filename.textContent = link.download;
    adapter.noteDownloadDispatched();
    await authoring.noteDownloaded(base64);
    downloadOriginalMetadata.hidden = !adapter.recoverableOlderMetadataBytes;
    downloadDialog.close();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  })()
    .catch(reportActionError)
    .finally(() => setFileOperationBusy(false));
});
downloadOriginalMetadata.addEventListener("click", () => {
  const original = adapter.recoverableOlderMetadataBytes;
  if (!original) return;
  const url = URL.createObjectURL(new Blob([original], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "original-authoring-metadata.base64url.txt";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
});
retry.addEventListener("click", () => void adapter.retry());
function renderRecoveryEntries(): void {
  recoveryEntries.replaceChildren();
  const records = authoring.recoveryCandidates();
  if (records.length === 0) {
    recoveryEntries.textContent =
      "No local Recovery Drafts are available for this construction.";
    return;
  }
  for (const record of records) {
    const entry = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = `${record.drafts.length} Recovery Draft${record.drafts.length === 1 ? "" : "s"} · ${record.constructionFingerprint ? "Opened construction" : "Unsaved construction"}`;
    const details = document.createElement("p");
    details.textContent = `Saved ${new Date(record.savedAt).toLocaleString()} (${Math.max(0, Math.floor((Date.now() - record.savedAt) / 3_600_000))} hours ago). Workspace ${record.workspaceId.slice(0, 8)}. Construction fingerprint ${record.constructionFingerprint?.slice(0, 20) ?? "none"}. Snapshot ${record.snapshot.length} base64 characters.${record.dirtyConstruction ? " Snapshot includes construction changes not downloaded." : ""} Draft divergence from the snapshot is reported after restore.`;
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "Restore snapshot and drafts";
    restore.addEventListener("click", () => {
      if (authoring.hasAnyDraft() || authoring.dirtyConstruction())
        if (
          !window.confirm(
            "Restoring this local snapshot will replace the current construction and its Draft Sources. Continue?",
          )
        )
          return;
      void authoring
        .restoreRecovery(record.key)
        .then(() => {
          recoveryDialog.close();
          renderRecoveryEntries();
        })
        .catch(reportActionError);
    });
    const discard = document.createElement("button");
    discard.type = "button";
    discard.textContent = "Discard Recovery Draft";
    discard.addEventListener("click", () => {
      void authoring
        .discardRecovery(record.key)
        .then(renderRecoveryEntries)
        .catch(reportActionError);
    });
    entry.append(heading, details, restore, discard);
    recoveryEntries.append(entry);
  }
}
localRecovery.addEventListener("click", () => {
  renderRecoveryEntries();
  recoveryDialog.showModal();
});
closeRecovery.addEventListener("click", () => recoveryDialog.close());
recoveryDialog.addEventListener("close", () => localRecovery.focus());
clearLocalRecovery.addEventListener("click", () => {
  void (async () => {
    const size = await authoring.localRecoverySize();
    if (
      !window.confirm(
        `Clear ${size.records} local recovery records (${size.bytes} bytes) from this browser?`,
      )
    )
      return;
    const removed = await authoring.clearLocalRecovery();
    recoveryStatus.textContent = `Cleared ${removed.records} local recovery records (${removed.bytes} bytes).`;
    renderRecoveryEntries();
  })().catch(reportActionError);
});
window.addEventListener("pagehide", () => void authoring.dispose());
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
window.addEventListener("beforeunload", (event) => {
  if (!authoring.hasAnyDraft() && !authoring.dirtyConstruction()) return;
  event.preventDefault();
  event.returnValue = "";
});
void adapter.start().then(() => {
  if (adapter.state.kind === "ready") authoring.markConstructionClean();
});
