import { afterEach, expect, it, vi } from "vitest";
import { AuthoringWorkspace, type WorkspaceAdapter } from "../../src/workspace";
import type { ConstructionEvent, ManagedText } from "../../src/geogebra";

afterEach(() => vi.useRealTimers());

function fakeWorkspace(texts: ManagedText[]) {
  let listener: (event: ConstructionEvent) => void = () => {};
  const adapter: WorkspaceAdapter = {
    getSymbols: () => [],
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
  expect(workspace.canEditSelection).toBe(false);
  expect(workspace.selectionMessage).toMatch(/Unmanaged Text Object/);
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
