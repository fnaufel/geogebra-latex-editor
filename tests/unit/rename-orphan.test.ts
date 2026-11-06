import { afterEach, expect, it, vi } from "vitest";
import { GeoGebraAdapter, GEOGEBRA_VERSION } from "../../src/geogebra";
import {
  decodeMetadata,
  emptyMetadata,
  encodeMetadata,
} from "../../src/metadata";

afterEach(() => vi.unstubAllGlobals());

async function fixture(labels: string[], source = "literal") {
  const envelope = emptyMetadata();
  envelope.documents.one = {
    targetLabel: "text1",
    source,
    simplify: true,
    compiledFingerprint: "",
  };
  let encoded = encodeMetadata(envelope);
  const commands: Record<string, string> = Object.fromEntries(
    labels
      .filter((label) => label !== "gglatexEditorMetadataV1")
      .map((label) => [label, 'LaTeX("literal")']),
  );
  let renamed: (oldLabel: string, label: string) => void = () => {};
  const api = {
    getVersion: () => GEOGEBRA_VERSION,
    setWidth: () => {},
    setHeight: () => {},
    getAllObjectNames: () => [...labels, "gglatexEditorMetadataV1"],
    getObjectType: (label: string) =>
      labels.includes(label) || label === "gglatexEditorMetadataV1"
        ? "text"
        : "",
    getValueString: (label: string) =>
      label === "gglatexEditorMetadataV1" ? encoded : "literal",
    getCommandString: (label: string) => commands[label] ?? "",
    getXML: () => "<construction/>",
    setXML: () => {},
    evalCommandGetLabels: () => {
      labels.push("text2");
      commands.text2 = 'LaTeX(" ")';
      return "text2";
    },
    evalCommand: (command: string) => {
      if (command.startsWith('gglatexEditorMetadataV1="'))
        encoded = command.slice('gglatexEditorMetadataV1="'.length, -1);
      else if (command.startsWith("text2="))
        commands.text2 = command.slice("text2=".length);
      return false;
    },
    getViewProperties: () =>
      JSON.stringify({
        xMin: -5,
        yMin: -5,
        width: 10,
        height: 10,
        invXscale: 1,
        invYscale: 1,
      }),
    setCoords: () => {},
    setVisible: () => {},
    setAuxiliary: () => {},
    setFixed: () => {},
    setUndoPoint: vi.fn(),
    registerRenameListener: (callback: typeof renamed) => {
      renamed = callback;
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
  return {
    adapter,
    api,
    commands,
    envelope: () => decodeMetadata(encoded)!,
    setFingerprint: (fingerprint: string) => {
      envelope.documents.one!.compiledFingerprint = fingerprint;
      encoded = encodeMetadata(envelope);
    },
    externalRename: (oldLabel: string, label: string) => {
      labels.splice(labels.indexOf(oldLabel), 1, label);
      commands[label] = commands[oldLabel]!;
      delete commands[oldLabel];
    },
    rename: (oldLabel: string, label: string) => {
      labels.splice(labels.indexOf(oldLabel), 1, label);
      commands[label] = commands[oldLabel]!;
      delete commands[oldLabel];
      renamed(oldLabel, label);
    },
  };
}

it("keeps deleted target source as an orphaned metadata record", async () => {
  const labels = ["text1"];
  const { adapter, envelope } = await fixture(labels);
  labels.pop();
  expect(adapter.getManagedTexts()).toEqual([]);
  expect(adapter.getOrphanedTexts()).toMatchObject([
    { id: "one", source: "literal", targetLabel: "text1" },
  ]);
  expect(envelope().documents.one?.source).toBe("literal");
});

it("recovers only one exact fingerprint match after an external target rename", async () => {
  const labels = ["text1"];
  const { adapter, api, envelope, commands, setFingerprint, externalRename } =
    await fixture(labels);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(commands.text1),
  );
  setFingerprint(
    `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
  );
  externalRename("text1", "outside");
  await adapter.reconcileMetadata();
  expect(adapter.getManagedTexts()).toMatchObject([
    { id: "one", targetLabel: "outside" },
  ]);
  labels.push("duplicate");
  commands.duplicate = commands.outside!;
  await adapter.reconcileMetadata();
  expect(adapter.getManagedTexts()).toEqual([]);
  expect(adapter.getOrphanedTexts()).toMatchObject([
    { id: "one", candidates: ["outside", "duplicate"] },
  ]);
  labels.pop();
  const duplicateRecord = {
    ...envelope(),
    documents: {
      ...envelope().documents,
      two: { ...envelope().documents.one!, targetLabel: "missing" },
    },
  };
  api.evalCommand(
    `gglatexEditorMetadataV1="${encodeMetadata(duplicateRecord)}"`,
  );
  await adapter.reconcileMetadata();
  expect(adapter.getManagedTexts()).toEqual([]);
  expect(adapter.getOrphanedTexts()).toHaveLength(2);
});

it("writes target and proven reference renames to the same metadata record", async () => {
  const labels = ["text1", "a"];
  const { adapter, api, envelope, rename } = await fixture(
    labels,
    '@a+Text("a")@',
  );
  rename("text1", "renamedText");
  await vi.waitFor(() =>
    expect(envelope().documents.one?.targetLabel).toBe("renamedText"),
  );
  expect(adapter.getManagedTexts()[0]?.id).toBe("one");
  rename("a", "b");
  await vi.waitFor(() =>
    expect(envelope().documents.one?.source).toBe('@b+Text("a")@'),
  );
  expect(api.setUndoPoint).toHaveBeenCalledTimes(2);
});

it("restores deleted Authoring Source as a new managed target", async () => {
  const labels = ["text1"];
  const { adapter, envelope, api } = await fixture(labels);
  labels.pop();
  const restored = await adapter.restoreOrphanedText("one");
  expect(restored).toMatchObject({
    id: "one",
    targetLabel: "text2",
    source: "literal",
  });
  expect(envelope().documents.one?.targetLabel).toBe("text2");
  expect(adapter.getOrphanedTexts()).toEqual([]);
  expect(api.setUndoPoint).toHaveBeenCalledOnce();
});

it("does not attach a deleted target to an unrelated identical text", async () => {
  const labels = ["text1", "other"];
  const { adapter, commands, setFingerprint } = await fixture(labels);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(commands.text1),
  );
  setFingerprint(
    `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
  );
  labels.shift();
  await adapter.reconcileMetadata(false);
  expect(adapter.getManagedTexts()).toEqual([]);
  expect(adapter.getOrphanedTexts()).toMatchObject([
    { id: "one", source: "literal" },
  ]);
});

it("keeps a deleted target's fingerprint when a referenced object is renamed", async () => {
  const labels = ["text1", "a"];
  const { adapter, envelope, setFingerprint, rename } = await fixture(
    labels,
    "@a@",
  );
  const fingerprint = "sha256:original-target-command";
  setFingerprint(fingerprint);
  labels.splice(labels.indexOf("text1"), 1);
  rename("a", "b");
  await vi.waitFor(() => expect(envelope().documents.one?.source).toBe("@b@"));
  expect(envelope().documents.one?.compiledFingerprint).toBe(fingerprint);
  expect(adapter.getOrphanedTexts()).toMatchObject([
    { id: "one", source: "@b@", compiledFingerprint: fingerprint },
  ]);
});

it("discards only an orphaned metadata record with one undo point", async () => {
  const labels = ["text1"];
  const { adapter, envelope, api } = await fixture(labels);
  labels.pop();
  await adapter.discardOrphanedText("one");
  expect(envelope().documents).toEqual({});
  expect(adapter.getOrphanedTexts()).toEqual([]);
  expect(api.setUndoPoint).toHaveBeenCalledOnce();
});

it("leaves duplicate exact-label metadata claims unresolved on load", async () => {
  const { adapter, api, envelope } = await fixture(["text1"]);
  const duplicate = envelope();
  duplicate.documents.two = { ...duplicate.documents.one! };
  api.evalCommand(`gglatexEditorMetadataV1="${encodeMetadata(duplicate)}"`);
  await adapter.reconcileMetadata();
  expect(adapter.getManagedTexts()).toEqual([]);
  expect(adapter.getOrphanedTexts()).toMatchObject([
    { id: "one", targetLabel: "text1" },
    { id: "two", targetLabel: "text1" },
  ]);
});
