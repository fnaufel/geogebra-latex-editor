import { afterEach, expect, it, vi } from "vitest";
import { GeoGebraAdapter, GEOGEBRA_VERSION } from "../../src/geogebra";
import { emptyMetadata, encodeMetadata } from "../../src/metadata";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

async function adapterWithObjects(
  objects: Record<string, { type: string; value: string }>,
) {
  const writes: string[] = [];
  const events: unknown[] = [];
  const api = {
    getVersion: () => GEOGEBRA_VERSION,
    setWidth: () => {},
    setHeight: () => {},
    getAllObjectNames: () => Object.keys(objects),
    getObjectType: (label: string) => objects[label]?.type ?? "",
    getValueString: (label: string) => objects[label]?.value ?? "",
    getCommandString: () => 'LaTeX(" ")',
    getXML: () => "<construction/>",
    setXML: () => {},
    evalCommandGetLabels: () => {
      objects.text1 = { type: "text", value: " " };
      return "text1";
    },
    evalCommand: (command: string) => {
      writes.push(command);
      const match = command.match(/^([^=]+)="([A-Za-z0-9_-]+)"$/);
      if (match) objects[match[1]!] = { type: "text", value: match[2]! };
      return true;
    },
    getViewProperties: () =>
      JSON.stringify({
        xMin: 0,
        yMin: 0,
        width: 10,
        height: 10,
        invXscale: 1,
        invYscale: 1,
      }),
    setCoords: () => {},
    setVisible: () => {},
    setAuxiliary: () => {},
    setFixed: () => {},
    setUndoPoint: () => {},
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
  adapter.onEvent((event) => events.push(event));
  await adapter.start();
  return { adapter, objects, writes, events };
}

it("uses a safe suffix when the preferred label belongs to a user object", async () => {
  const fixture = await adapterWithObjects({
    gglatexEditorMetadataV1: { type: "numeric", value: "42" },
    gglatexEditorMetadata_1: { type: "text", value: "user text" },
  });
  await fixture.adapter.createManagedText();
  expect(fixture.objects.gglatexEditorMetadataV1).toEqual({
    type: "numeric",
    value: "42",
  });
  expect(fixture.objects.gglatexEditorMetadata_1?.value).toBe("user text");
  expect(fixture.objects.gglatexEditorMetadata_2?.type).toBe("text");
});

it("reports malformed metadata and leaves its bytes untouched", async () => {
  const fixture = await adapterWithObjects({
    gglatexEditorMetadataV1: { type: "text", value: "%%%" },
  });
  expect(fixture.events).toContainEqual({
    kind: "metadata-error",
    message: expect.stringContaining("malformed"),
  });
  expect(fixture.objects.gglatexEditorMetadataV1?.value).toBe("%%%");
});

it("reports a malformed prefix candidate even beside a valid carrier", async () => {
  const fixture = await adapterWithObjects({
    gglatexEditorMetadataV1: {
      type: "text",
      value: encodeMetadata(emptyMetadata()),
    },
    gglatexEditorMetadata_1: { type: "text", value: "%%%" },
  });
  expect(fixture.events).toContainEqual({
    kind: "metadata-error",
    message: expect.stringContaining("malformed metadata candidate"),
  });
  expect(fixture.objects.gglatexEditorMetadata_1?.value).toBe("%%%");
});

it("treats two valid carriers as ambiguous and refuses mutation", async () => {
  const value = encodeMetadata(emptyMetadata());
  const fixture = await adapterWithObjects({
    gglatexEditorMetadata_1: { type: "text", value },
    gglatexEditorMetadataV1: { type: "text", value },
  });
  expect(fixture.adapter.getManagedTexts()).toEqual([]);
  await expect(fixture.adapter.createManagedText()).rejects.toThrow(
    "ambiguous",
  );
  expect(fixture.objects.gglatexEditorMetadata_1?.value).toBe(value);
  expect(fixture.objects.gglatexEditorMetadataV1?.value).toBe(value);
});

it("preserves an unknown newer carrier byte-for-byte and refuses writes", async () => {
  const value = Buffer.from(
    JSON.stringify({
      application: "geogebra-latex-editor",
      schemaVersion: 2,
      languageVersion: 1,
      documents: {},
    }),
  ).toString("base64url");
  const fixture = await adapterWithObjects({
    gglatexEditorMetadataV1: { type: "text", value },
  });
  await expect(fixture.adapter.createManagedText()).rejects.toThrow("newer");
  expect(fixture.objects.gglatexEditorMetadataV1?.value).toBe(value);
  expect(fixture.writes).toEqual([]);
  expect(fixture.objects.text1).toBeUndefined();
});

it("does not choose a current carrier when newer metadata is also present", async () => {
  const current = encodeMetadata(emptyMetadata());
  const newer = Buffer.from(
    JSON.stringify({
      application: "geogebra-latex-editor",
      schemaVersion: 3,
      languageVersion: 1,
      documents: {},
    }),
  ).toString("base64url");
  const fixture = await adapterWithObjects({
    gglatexEditorMetadataV1: { type: "text", value: current },
    gglatexEditorMetadata_1: { type: "text", value: newer },
  });
  await expect(fixture.adapter.createManagedText()).rejects.toThrow("newer");
  expect(fixture.writes).toEqual([]);
  expect(fixture.objects.gglatexEditorMetadataV1?.value).toBe(current);
  expect(fixture.objects.gglatexEditorMetadata_1?.value).toBe(newer);
});

it("keeps the original older carrier bytes available after migration writes", async () => {
  const original = Buffer.from(
    JSON.stringify({
      application: "geogebra-latex-editor",
      schemaVersion: 0,
      documents: {},
    }),
  ).toString("base64url");
  const fixture = await adapterWithObjects({
    gglatexEditorMetadataV1: { type: "text", value: original },
  });
  expect(fixture.adapter.recoverableOlderMetadataBytes).toBe(original);
  fixture.adapter.noteDownloadDispatched();
  expect(fixture.adapter.recoverableOlderMetadataBytes).toBe(original);
  await fixture.adapter.createManagedText();
  expect(fixture.adapter.getManagedTexts()).toHaveLength(1);
  expect(fixture.adapter.recoverableOlderMetadataBytes).toBe(original);
  expect(fixture.objects.gglatexEditorMetadataV1?.value).not.toBe(original);
  const reloaded = await adapterWithObjects(fixture.objects);
  expect(reloaded.adapter.recoverableOlderMetadataBytes).toBe(original);
  reloaded.adapter.noteDownloadDispatched();
  expect(reloaded.adapter.recoverableOlderMetadataBytes).toBe(original);
  fixture.adapter.noteDownloadDispatched();
  expect(fixture.adapter.recoverableOlderMetadataBytes).toBeNull();
  expect(
    (await adapterWithObjects(fixture.objects)).adapter
      .recoverableOlderMetadataBytes,
  ).toBeNull();
});
