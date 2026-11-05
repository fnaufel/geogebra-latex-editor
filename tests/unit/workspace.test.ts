import { afterEach, expect, it, vi } from "vitest";
import { AuthoringWorkspace } from "../../src/workspace";

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
