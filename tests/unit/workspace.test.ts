import { afterEach, expect, it, vi } from "vitest";
import { AuthoringWorkspace, type WorkspaceAdapter } from "../../src/workspace";
import {
  ApplyFailure,
  type ConstructionEvent,
  type ManagedText,
} from "../../src/geogebra";

afterEach(() => vi.useRealTimers());

function fakeWorkspace(texts: ManagedText[]) {
  let listener: (event: ConstructionEvent) => void = () => {};
  const adapter: WorkspaceAdapter = {
    getSymbols: () => [],
    getUnmanagedTextSnapshot: () => "unmanaged",
    adoptUnmanagedText: async () => texts[0]!,
    createManagedText: async () => texts[0]!,
    applyManagedText: async () => texts[0]!,
    importBase64: async () => {},
    getManagedTexts: () => texts,
    exportBase64: async () => "file",
    onEvent: (callback) => {
      listener = callback;
      return () => {};
    },
  };
  return {
    workspace: new AuthoringWorkspace(() => {}, adapter),
    emit: (event: ConstructionEvent) => listener(event),
  };
}

it("debounces draft feedback for 300 ms and never sends it to GeoGebra", () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  const workspace = new AuthoringWorkspace(onChange);
  workspace.setSource("@missing@");
  vi.advanceTimersByTime(200);
  workspace.setSource("@a@");
  workspace.setSymbols([{ label: "a", type: "number", defined: true }]);
  expect(onChange).not.toHaveBeenCalled();
  vi.advanceTimersByTime(299);
  expect(onChange).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(workspace.result.expression).toBe(
    "FormulaText(Simplify(FormulaText((a))))",
  );
  expect(onChange).toHaveBeenCalledOnce();
});

it("keeps source and simplification as a draft until explicit Apply", async () => {
  let applied = {
    id: "doc-1",
    targetLabel: "text1",
    source: "",
    simplify: true,
    compiledFingerprint: "sha256:old",
  };
  const applyManagedText = vi.fn(
    async (_id: string, source: string, simplify: boolean) => {
      applied = {
        ...applied,
        source,
        simplify,
        compiledFingerprint: "sha256:new",
      };
      return applied;
    },
  );
  const adapter: WorkspaceAdapter = {
    getSymbols: () => [],
    getUnmanagedTextSnapshot: () => "unmanaged",
    adoptUnmanagedText: async () => applied,
    createManagedText: async () => applied,
    applyManagedText,
    importBase64: async () => {},
    getManagedTexts: () => [applied],
    exportBase64: async () => "file",
  };
  const workspace = new AuthoringWorkspace(() => {}, adapter);
  await workspace.create();
  expect(workspace.target?.simplify).toBe(true);
  workspace.setSource("λ✓漢字");
  workspace.setSimplify(false);
  workspace.validateNow();
  expect(workspace.hasDraft).toBe(true);
  expect(applyManagedText).not.toHaveBeenCalled();
  await workspace.apply();
  expect(applyManagedText).toHaveBeenCalledWith(
    "doc-1",
    "λ✓漢字",
    false,
    'FormulaText("λ✓漢字")',
  );
  expect(workspace.hasDraft).toBe(false);
  expect(workspace.target?.compiledFingerprint).toBe("sha256:new");
});

it("pins an explicitly selected text and retains each target's draft across selections", async () => {
  const first = {
    id: "one",
    targetLabel: "text1",
    source: "A",
    simplify: true,
    compiledFingerprint: "one",
  };
  const second = {
    id: "two",
    targetLabel: "text2",
    source: "B",
    simplify: false,
    compiledFingerprint: "two",
  };
  const { workspace, emit } = fakeWorkspace([first, second]);
  expect(workspace.selectionMessage).toMatch(/Select one text/);
  expect(workspace.editSelectedText()).toBe(false);
  emit({
    kind: "selection",
    selected: [{ label: "text1", type: "text", defined: true }],
  });
  expect(workspace.editSelectedText()).toBe(true);
  workspace.setSource("draft A");
  emit({
    kind: "selection",
    selected: [{ label: "a", type: "numeric", defined: true }],
  });
  expect(workspace.target?.id).toBe("one");
  expect(workspace.currentSource).toBe("draft A");
  expect(workspace.editSelectedText()).toBe(false);
  expect(workspace.selectionMessage).toMatch(/text object/);
  emit({
    kind: "selection",
    selected: [{ label: "unmanaged", type: "text", defined: true }],
  });
  expect(workspace.canEditSelection).toBe(true);
  expect(workspace.selectionMessage).toMatch(/Choose Edit selected text/);
  emit({
    kind: "selection",
    selected: [
      { label: "text1", type: "text", defined: true },
      { label: "text2", type: "text", defined: true },
    ],
  });
  expect(workspace.editSelectedText()).toBe(false);
  expect(workspace.selectionMessage).toMatch(/exactly one/);
  emit({
    kind: "selection",
    selected: [{ label: "text2", type: "text", defined: true }],
  });
  expect(workspace.editSelectedText()).toBe(true);
  expect(workspace.currentSource).toBe("B");
  expect(workspace.currentSimplify).toBe(false);
  workspace.setSource("draft B");
  emit({
    kind: "selection",
    selected: [{ label: "text1", type: "text", defined: true }],
  });
  workspace.editSelectedText();
  expect(workspace.currentSource).toBe("draft A");
  expect(workspace.hasDraft).toBe(true);
  emit({
    kind: "selection",
    selected: [{ label: "text2", type: "text", defined: true }],
  });
  workspace.editSelectedText();
  expect(workspace.currentSource).toBe("draft B");
});

it("opens unmanaged rendered LaTeX read-only, then adopts a literal snapshot across undo and redo", async () => {
  vi.useFakeTimers();
  const texts: ManagedText[] = [];
  let listener: (event: ConstructionEvent) => void = () => {};
  const adoptUnmanagedText = vi.fn(async (label: string, expected: string) => {
    expect(label).toBe("u");
    expect(expected).toBe("x@a@\\alpha");
    const adopted = {
      id: "adopted",
      targetLabel: label,
      source: "x@@a@@\\alpha",
      simplify: false,
      compiledFingerprint: "sha256:adopted",
    };
    texts.push(adopted);
    return adopted;
  });
  const adapter: WorkspaceAdapter = {
    getSymbols: () => [{ label: "u", type: "text", defined: true }],
    createManagedText: async () => texts[0]!,
    applyManagedText: async () => texts[0]!,
    adoptUnmanagedText,
    getUnmanagedTextSnapshot: () => "x@a@\\alpha",
    importBase64: async () => {},
    getManagedTexts: () => texts,
    exportBase64: async () => "file",
    onEvent: (callback) => {
      listener = callback;
      return () => {};
    },
  };
  const workspace = new AuthoringWorkspace(() => {}, adapter);
  listener({
    kind: "selection",
    selected: [{ label: "u", type: "text", defined: true }],
  });
  expect(workspace.editSelectedText()).toBe(true);
  expect(workspace.unmanagedTarget).toEqual({
    label: "u",
    renderedLatex: "x@a@\\alpha",
  });
  expect(workspace.target).toBeNull();
  expect(workspace.hasDraft).toBe(false);
  await expect(workspace.adopt(false)).rejects.toThrow(/Confirm Adoption/);
  expect(adoptUnmanagedText).not.toHaveBeenCalled();
  await workspace.adopt(true);
  expect(adoptUnmanagedText).toHaveBeenCalledOnce();
  expect(workspace.target?.source).toBe("x@@a@@\\alpha");
  expect(workspace.currentSimplify).toBe(false);
  workspace.setSource("my unapplied revision");
  texts.pop();
  listener({ kind: "undo" });
  await vi.runAllTimersAsync();
  expect(workspace.unmanagedTarget?.label).toBe("u");
  expect(workspace.target).toBeNull();
  expect(workspace.retainedDraftSource).toBe("my unapplied revision");
  expect(workspace.hasAnyDraft).toBe(true);
  expect(workspace.editSelectedText()).toBe(true);
  expect(workspace.retainedDraftSource).toBe("my unapplied revision");
  texts.push({
    id: "adopted",
    targetLabel: "u",
    source: "x@@a@@\\alpha",
    simplify: false,
    compiledFingerprint: "sha256:adopted",
  });
  listener({ kind: "redo" });
  await vi.runAllTimersAsync();
  expect(workspace.target?.id).toBe("adopted");
  expect(workspace.currentSource).toBe("my unapplied revision");
});

it("inserts one selected object at the saved cursor, rejects multiple selection, and cancels cleanly", async () => {
  const target = {
    id: "one",
    targetLabel: "text1",
    source: "abcd",
    simplify: true,
    compiledFingerprint: "one",
  };
  const { workspace, emit } = fakeWorkspace([target]);
  await workspace.create();
  workspace.startInsertion(2, 2);
  emit({
    kind: "selection",
    selected: [
      { label: "a", type: "numeric", defined: true },
      { label: "b", type: "point", defined: true },
    ],
  });
  expect(workspace.currentSource).toBe("abcd");
  expect(workspace.insertionMode).toBe(true);
  emit({
    kind: "selection",
    selected: [{ label: "b", type: "point", defined: true }],
  });
  await Promise.resolve();
  expect(workspace.currentSource).toBe("ab@b@cd");
  expect(workspace.insertionMode).toBe(false);
  workspace.startInsertion(0, 0);
  workspace.cancelInsertion();
  emit({
    kind: "selection",
    selected: [{ label: "c", type: "line", defined: true }],
  });
  expect(workspace.currentSource).toBe("ab@b@cd");
});

it("does not insert the first event of a batched multiple selection", async () => {
  const target = {
    id: "one",
    targetLabel: "text1",
    source: "body",
    simplify: true,
    compiledFingerprint: "one",
  };
  const { workspace, emit } = fakeWorkspace([target]);
  await workspace.create();
  workspace.startInsertion(0, 0);
  emit({
    kind: "selection",
    selected: [{ label: "a", type: "numeric", defined: true }],
  });
  emit({
    kind: "selection",
    selected: [
      { label: "a", type: "numeric", defined: true },
      { label: "b", type: "point", defined: true },
    ],
  });
  await Promise.resolve();
  expect(workspace.currentSource).toBe("body");
  expect(workspace.insertionMode).toBe(true);
  expect(workspace.interactionMessage).toMatch(/exactly one/);
});

it("resynchronizes Applied Source after history without replacing a Diverged Draft", async () => {
  vi.useFakeTimers();
  let applied: ManagedText = {
    id: "one",
    targetLabel: "text1",
    source: "initial",
    simplify: true,
    compiledFingerprint: "initial",
  };
  let emit: (event: ConstructionEvent) => void = () => {};
  const adapter: WorkspaceAdapter = {
    getSymbols: () => [],
    getUnmanagedTextSnapshot: () => "unmanaged",
    adoptUnmanagedText: async () => applied,
    createManagedText: async () => applied,
    applyManagedText: async () => applied,
    importBase64: async () => {},
    getManagedTexts: () => [applied],
    exportBase64: async () => "file",
    onEvent: (listener) => {
      emit = listener;
      return () => {};
    },
  };
  const workspace = new AuthoringWorkspace(() => {}, adapter);
  await workspace.create();
  workspace.setSource("my draft");
  applied = { ...applied, source: "after undo", compiledFingerprint: "undo" };
  emit({ kind: "undo" });
  await vi.runAllTimersAsync();
  expect(workspace.currentSource).toBe("my draft");
  expect(workspace.target?.source).toBe("after undo");
  expect(workspace.diverged).toBe(true);
  workspace.discardDraft();
  expect(workspace.currentSource).toBe("after undo");
  expect(workspace.diverged).toBe(false);
  applied = { ...applied, source: "after redo", compiledFingerprint: "redo" };
  emit({ kind: "redo" });
  await vi.runAllTimersAsync();
  expect(workspace.currentSource).toBe("after redo");
});

it("refreshes an unpinned target after history while preserving its real drafts", async () => {
  vi.useFakeTimers();
  const first: ManagedText = {
    id: "one",
    targetLabel: "text1",
    source: "first applied",
    simplify: true,
    compiledFingerprint: "first",
  };
  const second: ManagedText = {
    id: "two",
    targetLabel: "text2",
    source: "second applied",
    simplify: true,
    compiledFingerprint: "second",
  };
  let texts = [first, second];
  let emit: (event: ConstructionEvent) => void = () => {};
  const adapter: WorkspaceAdapter = {
    getSymbols: () => [],
    getUnmanagedTextSnapshot: () => "unmanaged",
    adoptUnmanagedText: async () => first,
    createManagedText: async () => first,
    applyManagedText: async () => first,
    importBase64: async () => {},
    getManagedTexts: () => texts,
    exportBase64: async () => "file",
    onEvent: (listener) => {
      emit = listener;
      return () => {};
    },
  };
  const workspace = new AuthoringWorkspace(() => {}, adapter);
  await workspace.create();
  emit({
    kind: "selection",
    selected: [{ label: "text2", type: "text", defined: true }],
  });
  workspace.editSelectedText();
  texts = [
    { ...first, source: "first after undo", compiledFingerprint: "undo" },
    second,
  ];
  emit({ kind: "undo" });
  await vi.runAllTimersAsync();
  emit({
    kind: "selection",
    selected: [{ label: "text1", type: "text", defined: true }],
  });
  workspace.editSelectedText();
  expect(workspace.currentSource).toBe("first after undo");
  expect(workspace.hasDraft).toBe(false);
  workspace.setSource("my first draft");
  emit({
    kind: "selection",
    selected: [{ label: "text2", type: "text", defined: true }],
  });
  workspace.editSelectedText();
  texts = [
    { ...first, source: "first after redo", compiledFingerprint: "redo" },
    second,
  ];
  emit({ kind: "redo" });
  await vi.runAllTimersAsync();
  emit({
    kind: "selection",
    selected: [{ label: "text1", type: "text", defined: true }],
  });
  workspace.editSelectedText();
  expect(workspace.currentSource).toBe("my first draft");
  expect(workspace.target?.source).toBe("first after redo");
  expect(workspace.diverged).toBe(true);
});

it("retains Draft Source when compilation or adapter Apply fails", async () => {
  const applied: ManagedText = {
    id: "one",
    targetLabel: "text1",
    source: "old",
    simplify: true,
    compiledFingerprint: "old",
  };
  const adapter: WorkspaceAdapter = {
    getSymbols: () => [],
    getUnmanagedTextSnapshot: () => "unmanaged",
    adoptUnmanagedText: async () => applied,
    createManagedText: async () => applied,
    applyManagedText: async () => {
      throw new Error("Metadata verification failed.");
    },
    importBase64: async () => {},
    getManagedTexts: () => [applied],
    exportBase64: async () => "file",
  };
  const workspace = new AuthoringWorkspace(() => {}, adapter);
  await workspace.create();
  workspace.setSource("@missing@");
  await expect(workspace.apply()).rejects.toThrow("Authoring Source errors");
  expect(workspace.currentSource).toBe("@missing@");
  workspace.setSource("new draft");
  await expect(workspace.apply()).rejects.toThrow(
    "Metadata verification failed.",
  );
  expect(workspace.currentSource).toBe("new draft");
  expect(workspace.target?.source).toBe("old");
  expect(workspace.hasDraft).toBe(true);
});

it("keeps Apply failure diagnostics with workspace state until the draft is discarded", async () => {
  const text: ManagedText = {
    id: "one",
    targetLabel: "text1",
    source: "old",
    simplify: true,
    compiledFingerprint: "old",
  };
  const { workspace } = fakeWorkspace([text]);
  await workspace.create();
  workspace.setSource("my draft");
  workspace.reportActionError(
    new ApplyFailure(
      "APPLY_ROLLED_BACK",
      "Apply failed; Draft Source was retained.",
      "APPLY_METADATA_FAILED",
    ),
    false,
  );
  expect(workspace.actionError).toContain(
    "[APPLY_ROLLED_BACK/APPLY_METADATA_FAILED]",
  );
  expect(workspace.currentSource).toBe("my draft");
  workspace.discardDraft();
  expect(workspace.actionError).toBeNull();
});

it("keeps a pinned target and its draft when the target is renamed", async () => {
  vi.useFakeTimers();
  let text: ManagedText = {
    id: "one",
    targetLabel: "text1",
    source: "@a@",
    simplify: true,
    compiledFingerprint: "one",
  };
  let emit: (event: ConstructionEvent) => void = () => {};
  const adapter: WorkspaceAdapter = {
    getSymbols: () => [
      { label: "a", type: "number", defined: true },
      { label: text.targetLabel, type: "text", defined: true },
    ],
    getUnmanagedTextSnapshot: () => "",
    adoptUnmanagedText: async () => text,
    createManagedText: async () => text,
    applyManagedText: async () => text,
    importBase64: async () => {},
    getManagedTexts: () => [text],
    exportBase64: async () => "",
    onEvent: (listener) => {
      emit = listener;
      return () => {};
    },
  };
  const workspace = new AuthoringWorkspace(() => {}, adapter);
  await workspace.create();
  workspace.setSource("draft @a@");
  text = { ...text, targetLabel: "renamed" };
  emit({ kind: "rename", oldLabel: "text1", label: "renamed" });
  await vi.runAllTimersAsync();
  expect(workspace.target).toMatchObject({ id: "one", targetLabel: "renamed" });
  expect(workspace.currentSource).toBe("draft @a@");
  expect(workspace.hasDraft).toBe(true);
});

it("rewrites proven references in drafts after a live rename and distinguishes deletion from undefined values", async () => {
  vi.useFakeTimers();
  let symbols = [
    { label: "a", type: "number", defined: true },
    { label: "text1", type: "text", defined: true },
  ];
  const text: ManagedText = {
    id: "one",
    targetLabel: "text1",
    source: "@a@",
    simplify: true,
    compiledFingerprint: "one",
  };
  let emit: (event: ConstructionEvent) => void = () => {};
  const adapter: WorkspaceAdapter = {
    getSymbols: () => symbols,
    getUnmanagedTextSnapshot: () => "",
    adoptUnmanagedText: async () => text,
    createManagedText: async () => text,
    applyManagedText: async () => text,
    importBase64: async () => {},
    getManagedTexts: () => [text],
    exportBase64: async () => "",
    onEvent: (listener) => {
      emit = listener;
      return () => {};
    },
  };
  const workspace = new AuthoringWorkspace(() => {}, adapter);
  await workspace.create();
  workspace.setSource('@a+Text("a")@');
  symbols = [{ label: "b", type: "number", defined: true }, symbols[1]!];
  emit({ kind: "rename", oldLabel: "a", label: "b" });
  await vi.runAllTimersAsync();
  expect(workspace.currentSource).toBe('@b+Text("a")@');
  symbols = [{ ...symbols[0]!, defined: false }, symbols[1]!];
  emit({ kind: "object", change: "update", label: "b" });
  await vi.runAllTimersAsync();
  expect(workspace.result.diagnostics.map(({ code }) => code)).toContain(
    "undefined-value",
  );
  symbols = [symbols[1]!];
  emit({ kind: "object", change: "remove", label: "b" });
  await vi.runAllTimersAsync();
  expect(workspace.result.diagnostics.map(({ code }) => code)).toContain(
    "unresolved-reference",
  );
  expect(workspace.currentSource).toBe('@b+Text("a")@');
});

it("preserves Orphaned Source on target deletion, reattaches on undo, and restores to a new target", async () => {
  vi.useFakeTimers();
  const original: ManagedText = {
    id: "one",
    targetLabel: "text1",
    source: "body",
    simplify: true,
    compiledFingerprint: "one",
  };
  let texts: ManagedText[] = [original];
  let emit: (event: ConstructionEvent) => void = () => {};
  const restoreOrphanedText = vi.fn(async () => {
    const restored = { ...original, targetLabel: "text2" };
    texts = [restored];
    return restored;
  });
  const adapter: WorkspaceAdapter = {
    getSymbols: () =>
      texts.map(({ targetLabel }) => ({
        label: targetLabel,
        type: "text",
        defined: true,
      })),
    getUnmanagedTextSnapshot: () => "",
    adoptUnmanagedText: async () => original,
    createManagedText: async () => original,
    applyManagedText: async () => original,
    importBase64: async () => {},
    getManagedTexts: () => texts,
    getOrphanedTexts: () =>
      texts.length ? [] : [{ ...original, candidates: [] }],
    restoreOrphanedText,
    exportBase64: async () => "",
    onEvent: (listener) => {
      emit = listener;
      return () => {};
    },
  };
  const workspace = new AuthoringWorkspace(() => {}, adapter);
  await workspace.create();
  workspace.setSource("my draft");
  texts = [];
  emit({ kind: "object", change: "remove", label: "text1" });
  await vi.runAllTimersAsync();
  expect(workspace.orphanedTarget).toMatchObject({ id: "one", source: "body" });
  expect(workspace.currentSource).toBe("my draft");
  texts = [original];
  emit({ kind: "undo" });
  await vi.runAllTimersAsync();
  expect(workspace.target?.id).toBe("one");
  expect(workspace.currentSource).toBe("my draft");
  texts = [];
  emit({ kind: "redo" });
  await vi.runAllTimersAsync();
  await workspace.restoreOrphaned();
  expect(restoreOrphanedText).toHaveBeenCalledWith("one", "my draft", true);
  expect(workspace.target?.targetLabel).toBe("text2");
  expect(workspace.currentSource).toBe("my draft");
});
