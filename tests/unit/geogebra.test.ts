import { afterEach, describe, expect, it, vi } from "vitest";
import { GeoGebraAdapter, GEOGEBRA_VERSION } from "../../src/geogebra";
import { emptyMetadata, encodeMetadata } from "../../src/metadata";

afterEach(() => vi.unstubAllGlobals());

describe("GeoGebra applet lifecycle", () => {
  it("waits for appletOnLoad before reporting ready and configures the host-owned controls", async () => {
    let onLoad:
      | ((api: {
          getVersion: () => string;
          setWidth: () => void;
          setHeight: () => void;
        }) => void)
      | undefined;
    const instances: Array<{
      params: Record<string, unknown>;
      codebase?: string;
    }> = [];
    vi.stubGlobal(
      "GGBApplet",
      class {
        private instance: {
          params: Record<string, unknown>;
          codebase?: string;
        };
        constructor(params: Record<string, unknown>) {
          this.instance = { params };
          instances.push(this.instance);
          onLoad = params.appletOnLoad as typeof onLoad;
        }
        setHTML5Codebase(value: string) {
          this.instance.codebase = value;
        }
        inject() {}
      },
    );
    const container = document.createElement("div");
    const adapter = new GeoGebraAdapter(
      container,
      () => {},
      async () => {},
    );
    const loading = adapter.start();
    await Promise.resolve();
    expect(adapter.state.kind).toBe("loading");
    expect(instances[0]?.params).toMatchObject({
      appName: "classic",
      showToolBar: true,
      enableUndoRedo: true,
      showMenuBar: false,
      enableFileFeatures: false,
      showAlgebraInput: false,
    });
    expect(instances[0]?.codebase).toBe(
      `https://www.geogebra.org/apps/${GEOGEBRA_VERSION}/web3d`,
    );
    onLoad?.({
      getVersion: () => GEOGEBRA_VERSION,
      setWidth: () => {},
      setHeight: () => {},
    });
    await loading;
    expect(adapter.state).toEqual({ kind: "ready", version: GEOGEBRA_VERSION });
  });

  it("reports version mismatch and allows a fresh retry", async () => {
    let onLoad:
      | ((api: {
          getVersion: () => string;
          setWidth: () => void;
          setHeight: () => void;
        }) => void)
      | undefined;
    vi.stubGlobal(
      "GGBApplet",
      class {
        constructor(params: Record<string, unknown>) {
          onLoad = params.appletOnLoad as typeof onLoad;
        }
        setHTML5Codebase() {}
        inject() {}
      },
    );
    const adapter = new GeoGebraAdapter(
      document.createElement("div"),
      () => {},
      async () => {},
    );
    const first = adapter.start();
    await Promise.resolve();
    onLoad?.({
      getVersion: () => "5.4.919.0",
      setWidth: () => {},
      setHeight: () => {},
    });
    await first;
    expect(adapter.state).toEqual({
      kind: "version-mismatch",
      actual: "5.4.919.0",
    });
    const second = adapter.retry();
    await Promise.resolve();
    onLoad?.({
      getVersion: () => GEOGEBRA_VERSION,
      setWidth: () => {},
      setHeight: () => {},
    });
    await second;
    expect(adapter.state.kind).toBe("ready");
  });

  it("shows an initialization failure and retries without destroying its host element", async () => {
    const container = document.createElement("div");
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(undefined);
    vi.stubGlobal(
      "GGBApplet",
      class {
        constructor(private params: Record<string, unknown>) {}
        setHTML5Codebase() {}
        inject() {
          const callback = this.params.appletOnLoad as (api: unknown) => void;
          callback({
            getVersion: () => GEOGEBRA_VERSION,
            setWidth: () => {},
            setHeight: () => {},
          });
        }
      },
    );
    const adapter = new GeoGebraAdapter(container, () => {}, load);
    await adapter.start();
    expect(adapter.state.kind).toBe("error");
    await adapter.retry();
    expect(adapter.state.kind).toBe("ready");
    expect(adapter.element).toBe(container);
  });
});

it("keeps Applied Source intact when GeoGebra rejects a new definition", async () => {
  const envelope = emptyMetadata();
  envelope.documents["document-1"] = {
    targetLabel: "text1",
    source: "old",
    simplify: true,
    compiledFingerprint: "sha256:old",
  };
  const encoded = encodeMetadata(envelope);
  const commands: string[] = [];
  let presentation = '<element label="text1"/>';
  let corruptOnRestore = false;
  const api = {
    getVersion: () => GEOGEBRA_VERSION,
    setWidth: () => {},
    setHeight: () => {},
    getAllObjectNames: () => ["text1", "gglatexEditorMetadataV1"],
    getObjectType: () => "text",
    getValueString: (label: string) =>
      label === "gglatexEditorMetadataV1" ? encoded : "old",
    getCommandString: () => 'LaTeX("old")',
    getXML: (label?: string) => (label ? presentation : "<construction/>"),
    setXML: () => {
      if (corruptOnRestore)
        presentation = '<element label="text1" color="red"/>';
    },
    evalCommand: (command: string) => {
      commands.push(command);
      return false;
    },
  };
  vi.stubGlobal(
    "GGBApplet",
    class {
      constructor(private params: Record<string, unknown>) {}
      setHTML5Codebase() {}
      inject() {
        (this.params.appletOnLoad as (api: unknown) => void)(api);
      }
    },
  );
  const adapter = new GeoGebraAdapter(
    document.createElement("div"),
    () => {},
    async () => {},
  );
  await adapter.start();
  await expect(
    adapter.applyManagedText(
      "document-1",
      "new",
      true,
      'FormulaText(Simplify("new"))',
    ),
  ).rejects.toThrow("Compiled Definition");
  expect(adapter.getManagedTexts()[0]?.source).toBe("old");
  expect(commands).toHaveLength(1);
  corruptOnRestore = true;
  await expect(
    adapter.applyManagedText(
      "document-1",
      "new",
      true,
      'FormulaText(Simplify("new"))',
    ),
  ).rejects.toThrow("Apply rollback failed.");
  expect(adapter.getManagedTexts()[0]?.source).toBe("old");
});
