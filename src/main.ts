import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
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
        <strong>No Editing Target</strong>
        <p>No text is open for editing.</p>
      </div>
      <div id="editor" class="editor-host" aria-label="Authoring Source editor"></div>
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

// Keep the editor mounted across applet failures and retries so its local state survives.
new EditorView({
  state: EditorState.create({
    extensions: [
      basicSetup,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": "Authoring Source" }),
    ],
  }),
  parent: editorHost,
});

function renderAppletState(state: AppletState): void {
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
