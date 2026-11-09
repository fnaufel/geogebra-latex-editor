import { afterEach, expect, it, vi } from "vitest";
import { GeoGebraAdapter, GEOGEBRA_VERSION } from "../../src/geogebra";
import { emptyMetadata, encodeMetadata } from "../../src/metadata";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Failure =
  | "stage-definition"
  | "stage-presentation"
  | "restore-before-group"
  | "group-definition"
  | "group-value"
  | "group-metadata"
  | "group-presentation"
  | "group-metadata-presentation"
  | "selection-restore"
  | "undo-point"
  | "rollback";

async function applet(failure?: Failure) {
  const envelope = emptyMetadata();
  envelope.documents.one = {
    targetLabel: "text1",
    source: "old",
    simplify: true,
    compiledFingerprint: "sha256:old",
  };
  const initialMetadata = encodeMetadata(envelope);
  const initial = {
    command: 'LaTeX("old")',
    caption: "Styled caption",
    targetValue: "old rendered",
    metadata: initialMetadata,
    targetPresentation: '<element label="text1" color="blue" layer="2"/>',
    metadataPresentation:
      '<element label="gglatexEditorMetadataV1" hidden="true"/>',
  };
  let state = { ...initial };
  let restoreCount = 0;
  let undoPoints = 0;
  let clientListener: (event: unknown) => void = () => {};
  const api = {
    getVersion: () => GEOGEBRA_VERSION,
    setWidth: () => {},
    setHeight: () => {},
    getAllObjectNames: () => ["text1", "gglatexEditorMetadataV1"],
    getObjectType: () => "text",
    getValueString: (label: string) =>
      label === "gglatexEditorMetadataV1" ? state.metadata : state.targetValue,
    getCommandString: () => state.command,
    getCaption: () => state.caption,
    setCaption: (_label: string, caption: string) => {
      state.caption = caption;
    },
    getXML: (label?: string) =>
      label === "text1"
        ? state.targetPresentation
        : label === "gglatexEditorMetadataV1"
          ? state.metadataPresentation
          : JSON.stringify(state),
    setXML: (xml: string) => {
      restoreCount++;
      state = JSON.parse(xml) as typeof state;
      if (
        (failure === "restore-before-group" && restoreCount === 1) ||
        (failure === "rollback" && restoreCount > 1)
      )
        state.command = 'LaTeX("damaged")';
    },
    evalCommand: (command: string) => {
      if (command.startsWith("SelectObjects("))
        return failure !== "selection-restore";
      const [definition, metadata] = command.split("\n");
      const grouped = metadata !== undefined;
      if (failure !== (grouped ? "group-definition" : "stage-definition")) {
        state.command = definition!.slice("text1=".length);
        state.targetValue = "new rendered";
        state.caption = "";
      }
      if (grouped && failure === "group-value") state.targetValue = "wrong";
      if (grouped && failure !== "group-metadata" && failure !== "rollback")
        state.metadata = metadata!.slice(
          'gglatexEditorMetadataV1="'.length,
          -1,
        );
      if (failure === (grouped ? "group-presentation" : "stage-presentation"))
        state.targetPresentation = '<element label="text1" color="red"/>';
      if (grouped && failure === "group-metadata-presentation")
        state.metadataPresentation =
          '<element label="gglatexEditorMetadataV1" hidden="false"/>';
      if (grouped && failure === "selection-restore")
        clientListener(["deselect", "", ""]);
      return false;
    },
    setVisible: () => {},
    setAuxiliary: () => {},
    setFixed: () => {},
    setUndoPoint: () => {
      if (failure === "undo-point") throw new Error("Undo unavailable.");
      undoPoints++;
    },
    registerClientListener: (listener: (event: unknown) => void) => {
      clientListener = listener;
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
  if (failure === "selection-restore") clientListener(["select", "text1", ""]);
  return {
    adapter,
    api,
    initial,
    state: () => state,
    undoPoints: () => undoPoints,
  };
}

const apply = (adapter: GeoGebraAdapter) =>
  adapter.applyManagedText("one", "new", true, 'FormulaText(Simplify("new"))');

it("commits observed definition and metadata together despite a false evalCommand result", async () => {
  const fixture = await applet();
  const applied = await apply(fixture.adapter);
  expect(applied.source).toBe("new");
  expect(fixture.adapter.getManagedTexts()[0]?.source).toBe("new");
  expect(fixture.state().targetPresentation).toBe(
    fixture.initial.targetPresentation,
  );
  expect(fixture.state().metadataPresentation).toBe(
    fixture.initial.metadataPresentation,
  );
  expect(fixture.undoPoints()).toBe(1);
});

it("refuses Apply before mutation when the construction snapshot is unavailable", async () => {
  const fixture = await applet();
  vi.spyOn(fixture.api, "getXML").mockReturnValueOnce("");
  await expect(apply(fixture.adapter)).rejects.toThrow("cannot snapshot");
  expect(fixture.state()).toEqual(fixture.initial);
  expect(fixture.undoPoints()).toBe(0);
});

it("rolls back when fingerprinting the staged definition fails", async () => {
  const fixture = await applet();
  vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(
    new Error("digest unavailable"),
  );
  await expect(apply(fixture.adapter)).rejects.toMatchObject({
    code: "APPLY_ROLLED_BACK",
    reason: "APPLY_MUTATION_FAILED",
  });
  expect(fixture.state()).toEqual(fixture.initial);
  expect(fixture.undoPoints()).toBe(0);
});

it.each<{
  failure: Failure;
  reason: string;
}>([
  { failure: "stage-definition", reason: "APPLY_GEOGEBRA_REJECTED" },
  { failure: "stage-presentation", reason: "APPLY_POSTCONDITION_FAILED" },
  { failure: "restore-before-group", reason: "APPLY_POSTCONDITION_FAILED" },
  { failure: "group-definition", reason: "APPLY_POSTCONDITION_FAILED" },
  { failure: "group-value", reason: "APPLY_POSTCONDITION_FAILED" },
  { failure: "group-metadata", reason: "APPLY_METADATA_FAILED" },
  { failure: "group-presentation", reason: "APPLY_POSTCONDITION_FAILED" },
  { failure: "group-metadata-presentation", reason: "APPLY_METADATA_FAILED" },
  { failure: "undo-point", reason: "APPLY_MUTATION_FAILED" },
])(
  "restores both snapshots after $failure fails",
  async ({ failure, reason }) => {
    const fixture = await applet(failure);
    await expect(apply(fixture.adapter)).rejects.toMatchObject({
      code: "APPLY_ROLLED_BACK",
      reason,
    });
    expect(fixture.state()).toEqual(fixture.initial);
    expect(fixture.adapter.getManagedTexts()[0]?.source).toBe("old");
    expect(fixture.undoPoints()).toBe(0);
  },
);

it("reports rollback failure and records no undo point", async () => {
  const fixture = await applet("rollback");
  await expect(apply(fixture.adapter)).rejects.toMatchObject({
    code: "APPLY_ROLLBACK_FAILED",
    reason: "APPLY_METADATA_FAILED",
  });
  expect(fixture.undoPoints()).toBe(0);
  expect(fixture.adapter.hasRecoverableApplySnapshot).toBe(true);
  await expect(apply(fixture.adapter)).rejects.toThrow("Apply is disabled");
});

it("halts Apply if selection cannot be restored after a grouped mutation", async () => {
  const fixture = await applet("selection-restore");
  await expect(apply(fixture.adapter)).rejects.toMatchObject({
    code: "APPLY_ROLLBACK_FAILED",
    reason: "APPLY_POSTCONDITION_FAILED",
  });
  expect(fixture.undoPoints()).toBe(0);
  expect(fixture.adapter.hasRecoverableApplySnapshot).toBe(true);
});

it("keeps the recovery snapshot and Apply halt when restoration is incomplete", async () => {
  const fixture = await applet("rollback");
  await expect(apply(fixture.adapter)).rejects.toMatchObject({
    code: "APPLY_ROLLBACK_FAILED",
  });
  await expect(
    fixture.adapter.restoreApplySnapshot(
      fixture.adapter.recoverableApplySnapshot!,
    ),
  ).rejects.toThrow("did not match");
  expect(fixture.adapter.hasRecoverableApplySnapshot).toBe(true);
  await expect(apply(fixture.adapter)).rejects.toThrow("Apply is disabled");
});
