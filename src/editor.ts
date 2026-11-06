import {
  autocompletion,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { setDiagnostics } from "@codemirror/lint";
import { EditorState, Transaction } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { basicSetup } from "codemirror";
import {
  PURE_FUNCTIONS,
  SAFE_COMMANDS,
  scanSource,
  type CompileResult,
  type SymbolInfo,
} from "./compiler";
import { AuthoringWorkspace } from "./workspace";
import type { GeoGebraAdapter, ManagedText, OrphanedText } from "./geogebra";

export interface AuthoringUiState {
  target: ManagedText | null;
  unmanaged: { label: string; renderedLatex: string } | null;
  orphaned: OrphanedText | null;
  canRestoreOrphaned: boolean;
  retainedDraftSource: string | null;
  hasDraft: boolean;
  diverged: boolean;
  canApply: boolean;
  canEditSelection: boolean;
  selectionMessage: string;
  insertionMode: boolean;
  interactionMessage: string;
  actionError: string | null;
  recoveryAvailable: boolean;
}

const LATEX_COMPLETIONS = [
  "\\frac",
  "\\sqrt",
  "\\text",
  "\\left",
  "\\right",
  "\\alpha",
  "\\beta",
  "\\gamma",
  "\\pi",
  "\\sum",
  "\\int",
  "\\cdot",
  "\\times",
  "\\begin",
  "\\end",
  "\\overline",
  "\\vec",
  "\\mathbf",
];

function sourceCompletion(
  context: CompletionContext,
  symbols: () => readonly SymbolInfo[],
): CompletionResult | null {
  const before = context.state.doc.sliceString(0, context.pos);
  const interpolation = scanSource(before).openInterpolationFrom !== null;
  const match = interpolation
    ? /[\p{L}\p{M}\p{N}_]*$/u.exec(before)
    : /\\?[A-Za-z]*$/u.exec(before);
  if (!match || (!context.explicit && match[0].length === 0)) return null;
  const options = interpolation
    ? [
        ...symbols().map((symbol) => ({
          label: symbol.label,
          type: "variable",
          detail: `${symbol.type} · ${symbol.defined ? "defined" : "undefined"}`,
        })),
        ...Object.keys(SAFE_COMMANDS).map((label) => ({
          label,
          type: "function",
        })),
        ...PURE_FUNCTIONS.map((label) => ({ label, type: "function" })),
        ...["x", "y", "z", "true", "false", "π", "ℯ"].map((label) => ({
          label,
          type: "constant",
        })),
      ]
    : LATEX_COMPLETIONS.map((label) => ({ label, type: "keyword" }));
  return { from: context.pos - match[0].length, options };
}

function syntaxDecorations(view: EditorView) {
  const source = view.state.doc.toString();
  const marks: ReturnType<ReturnType<typeof Decoration.mark>["range"]>[] = [];
  const scan = scanSource(source);
  const interpolations = scan.segments.filter(
    (segment) => segment.kind === "interpolation",
  );
  for (const segment of interpolations)
    marks.push(
      Decoration.mark({ class: "cm-interpolation" }).range(
        segment.from,
        segment.to,
      ),
    );
  if (scan.openInterpolationFrom !== null)
    marks.push(
      Decoration.mark({ class: "cm-interpolation-unclosed" }).range(
        scan.openInterpolationFrom,
        scan.openInterpolationFrom + 1,
      ),
    );
  const latex = /\\(?:[A-Za-z]+|\\)/g;
  for (const match of source.matchAll(latex)) {
    const from = match.index;
    const to = from + match[0].length;
    if (
      !interpolations.some((range) => from >= range.from && to <= range.to) &&
      (scan.openInterpolationFrom === null || from < scan.openInterpolationFrom)
    )
      marks.push(
        Decoration.mark({ class: "cm-latex-command" }).range(from, to),
      );
  }
  return Decoration.set(marks, true);
}

const highlighting = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view: EditorView) {
      this.decorations = syntaxDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = syntaxDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export function mountAuthoringEditor(
  editorHost: HTMLElement,
  diagnosticsHost: HTMLElement,
  compiledHost: HTMLElement,
  simplifyInput: HTMLInputElement,
  copyButton: HTMLButtonElement,
  adapter: GeoGebraAdapter,
  onState: (state: AuthoringUiState) => void,
): {
  refreshSymbols: () => void;
  create: () => Promise<ManagedText>;
  apply: () => Promise<ManagedText>;
  open: (base64: string) => Promise<ManagedText | null>;
  exportBase64: () => Promise<string>;
  hasDraft: () => boolean;
  hasAnyDraft: () => boolean;
  editSelectedText: () => boolean;
  adopt: () => Promise<ManagedText>;
  restoreOrphaned: () => Promise<ManagedText>;
  discardDraft: () => void;
  reportActionError: (error: unknown) => Promise<void>;
  clearActionError: () => void;
  recoverFailedApply: () => Promise<void>;
  startInsertion: () => void;
  cancelInsertion: () => void;
} {
  const getSymbols = () => adapter.getSymbols();
  let replacing = false;
  let shownId: string | null = null;
  const states = new Map<string, EditorState>();
  const emitState = (canApply = workspace.result.expression !== null) =>
    onState({
      target: workspace.target,
      unmanaged: workspace.unmanagedTarget,
      orphaned: workspace.orphanedTarget,
      canRestoreOrphaned: workspace.canRestoreOrphaned,
      retainedDraftSource: workspace.retainedDraftSource,
      hasDraft: workspace.hasDraft,
      diverged: workspace.diverged,
      canApply,
      canEditSelection: workspace.canEditSelection,
      selectionMessage: workspace.selectionMessage,
      insertionMode: workspace.insertionMode,
      interactionMessage: workspace.interactionMessage,
      actionError: workspace.actionError,
      recoveryAvailable: workspace.recoveryAvailable,
    });
  const render = (result: CompileResult) => {
    if (
      (workspace.target?.id ?? workspace.orphanedTarget?.id ?? null) !== shownId
    ) {
      showTarget();
      return;
    }
    if (
      (workspace.target?.id ?? workspace.orphanedTarget?.id) === shownId &&
      view.state.doc.toString() !== workspace.currentSource
    ) {
      replacing = true;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: workspace.currentSource,
        },
        annotations: Transaction.addToHistory.of(false),
      });
      replacing = false;
    }
    simplifyInput.checked = workspace.currentSimplify;
    compiledHost.textContent =
      result.expression ?? "No definition while errors remain.";
    copyButton.disabled = result.expression === null;
    diagnosticsHost.replaceChildren();
    if (result.diagnostics.length === 0) {
      const message = document.createElement("p");
      message.textContent = "No diagnostics.";
      diagnosticsHost.append(message);
    }
    for (const diagnostic of result.diagnostics) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "diagnostic";
      button.textContent = `${diagnostic.severity === "error" ? "Error" : "Warning"} · ${diagnostic.message} (characters ${diagnostic.from + 1}–${diagnostic.to})`;
      button.addEventListener("click", () => {
        view.dispatch({
          selection: { anchor: diagnostic.from, head: diagnostic.to },
          scrollIntoView: true,
        });
        view.focus();
      });
      diagnosticsHost.append(button);
    }
    view.dispatch(
      setDiagnostics(
        view.state,
        result.diagnostics.map((diagnostic) => ({
          from: Math.min(diagnostic.from, view.state.doc.length),
          to: Math.min(diagnostic.to, view.state.doc.length),
          severity: diagnostic.severity,
          message: diagnostic.message,
        })),
      ),
    );
    if (view.hasFocus) startCompletion(view);
    emitState(result.expression !== null);
  };
  const workspace = new AuthoringWorkspace(
    render,
    adapter,
    (from, to, text) => {
      replacing = true;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      replacing = false;
      view.focus();
    },
  );
  const extensions = [
    basicSetup,
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": "Authoring Source" }),
    highlighting,
    autocompletion({
      activateOnTyping: false,
      override: [
        (context: CompletionContext) => sourceCompletion(context, getSymbols),
      ],
    }),
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (!update.docChanged || replacing) return;
      workspace.setSource(update.state.doc.toString());
      workspace.setSymbols(getSymbols());
      emitState(false);
    }),
  ];
  const view = new EditorView({
    state: EditorState.create({ extensions }),
    parent: editorHost,
  });
  simplifyInput.addEventListener("change", () => {
    workspace.setSimplify(simplifyInput.checked);
    emitState(false);
  });
  copyButton.addEventListener("click", async () => {
    const definition = workspace.result.expression;
    if (definition) await navigator.clipboard.writeText(definition);
  });
  render(workspace.result);
  function showTarget(): void {
    if (shownId) states.set(shownId, view.state);
    const nextId = workspace.target?.id ?? workspace.orphanedTarget?.id ?? null;
    replacing = true;
    if (
      nextId !== shownId ||
      view.state.doc.toString() !== workspace.currentSource
    )
      view.setState(
        nextId && states.has(nextId)
          ? states.get(nextId)!
          : EditorState.create({ doc: workspace.currentSource, extensions }),
      );
    shownId = nextId;
    replacing = false;
    simplifyInput.checked = workspace.currentSimplify;
    render(workspace.result);
    if (workspace.target) view.focus();
  }
  return {
    refreshSymbols: () => {
      workspace.setSymbols(getSymbols());
      emitState(false);
    },
    create: async () => {
      const target = await workspace.create();
      showTarget();
      return target;
    },
    apply: async () => {
      const target = await workspace.apply();
      emitState();
      return target;
    },
    open: async (base64) => {
      const target = await workspace.open(base64);
      states.clear();
      shownId = null;
      showTarget();
      return target;
    },
    exportBase64: () => workspace.exportBase64(),
    hasDraft: () => workspace.hasDraft,
    hasAnyDraft: () => workspace.hasAnyDraft,
    editSelectedText: () => {
      const pinned = workspace.editSelectedText();
      if (pinned) showTarget();
      return pinned;
    },
    adopt: async () => {
      const target = await workspace.adopt(true);
      showTarget();
      return target;
    },
    restoreOrphaned: async () => {
      const target = await workspace.restoreOrphaned();
      showTarget();
      return target;
    },
    discardDraft: () => workspace.discardDraft(),
    reportActionError: (error) =>
      workspace.reportActionError(error, adapter.hasRecoverableApplySnapshot),
    clearActionError: () => workspace.clearActionError(),
    recoverFailedApply: async () => {
      await workspace.recoverFailedApply();
      states.clear();
      shownId = null;
      showTarget();
    },
    startInsertion: () => {
      const { from, to } = view.state.selection.main;
      workspace.startInsertion(from, to);
    },
    cancelInsertion: () => {
      workspace.cancelInsertion();
      view.focus();
    },
  };
}
