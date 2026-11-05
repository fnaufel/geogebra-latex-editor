import {
  autocompletion,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { setDiagnostics } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
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
  getSymbols: () => readonly SymbolInfo[],
): { refreshSymbols: () => void } {
  const render = (result: CompileResult) => {
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
  };
  const workspace = new AuthoringWorkspace(render);
  const view = new EditorView({
    state: EditorState.create({
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "Authoring Source" }),
        highlighting,
        autocompletion({
          activateOnTyping: false,
          override: [(context) => sourceCompletion(context, getSymbols)],
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          workspace.setSource(update.state.doc.toString());
          workspace.setSymbols(getSymbols());
        }),
      ],
    }),
    parent: editorHost,
  });
  simplifyInput.addEventListener("change", () =>
    workspace.setSimplify(simplifyInput.checked),
  );
  copyButton.addEventListener("click", async () => {
    const definition = workspace.result.expression;
    if (definition) await navigator.clipboard.writeText(definition);
  });
  render(workspace.result);
  return { refreshSymbols: () => workspace.setSymbols(getSymbols()) };
}
