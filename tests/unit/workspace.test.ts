import { afterEach, expect, it, vi } from "vitest";
import { AuthoringWorkspace, type WorkspaceAdapter } from "../../src/workspace";

afterEach(() => vi.useRealTimers());

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
    async (
      _id: string,
      source: string,
      simplify: boolean,
    ) => {
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
