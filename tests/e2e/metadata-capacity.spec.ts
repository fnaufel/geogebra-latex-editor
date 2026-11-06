import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  decodeMetadata,
  emptyMetadata,
  encodeMetadata,
} from "../../src/metadata";

test("offers original metadata after a tab reload and retains it after an unrelated download", async ({
  page,
}) => {
  test.slow();
  const original = Buffer.from(
    JSON.stringify({
      application: "geogebra-latex-editor",
      schemaVersion: 0,
      documents: {},
    }),
  ).toString("base64url");
  await page.addInitScript((value) => {
    sessionStorage.setItem("gglatex-editor:older-metadata", value);
  }, original);
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  const downloadOriginal = page.getByRole("button", {
    name: "Download original metadata",
  });
  await expect(downloadOriginal).toBeVisible();
  const originalDownload = page.waitForEvent("download");
  await downloadOriginal.click();
  expect(await readFile((await (await originalDownload).path())!, "utf8")).toBe(
    original,
  );
  const constructionDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .ggb" }).click();
  await constructionDownload;
  await expect(downloadOriginal).toBeVisible();
});

test("GeoGebra preserves a 1 MiB, 100-record auxiliary carrier through native export and open", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const envelope = emptyMetadata();
  for (let index = 0; index < 100; index++) {
    envelope.documents[`document-${index}`] = {
      targetLabel: `text${index + 1}`,
      source:
        index === 0 ? "λ✓漢字\\alpha\n".repeat(90_000) : `source ${index}`,
      simplify: index % 2 === 0,
      compiledFingerprint: `sha256:${index}`,
    };
  }
  expect(
    new TextEncoder().encode(JSON.stringify(envelope)).length,
  ).toBeGreaterThan(1024 * 1024);
  const encoded = encodeMetadata(envelope);
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  const observed = await page.evaluate(async (value) => {
    type Api = {
      evalCommand(command: string): boolean;
      getObjectType(label: string): string;
      getValueString(label: string): string;
      getBase64(callback: (base64: string) => void): void;
      setBase64(base64: string, callback: () => void): void;
      setVisible(label: string, visible: boolean): void;
      setAuxiliary(label: string, auxiliary: boolean): void;
      setFixed(label: string, fixed: boolean, selectionAllowed: boolean): void;
      getXML(label: string): string;
    };
    type Embed = {
      setHTML5Codebase(url: string): void;
      inject(element: HTMLElement): void;
    };
    const Applet = (
      window as unknown as {
        GGBApplet: new (
          parameters: Record<string, unknown>,
          html5: boolean,
        ) => Embed;
      }
    ).GGBApplet;
    const mount = async () => {
      const host = document.createElement("div");
      host.style.cssText = "width:400px;height:300px";
      document.body.append(host);
      const api = await new Promise<Api>((resolve) => {
        const applet = new Applet(
          {
            appName: "classic",
            width: 400,
            height: 300,
            showToolBar: true,
            enableUndoRedo: true,
            appletOnLoad: resolve,
          },
          true,
        );
        applet.setHTML5Codebase(
          "https://www.geogebra.org/apps/5.4.920.0/web3d",
        );
        applet.inject(host);
      });
      return api;
    };
    const first = await mount();
    for (let index = 1; index <= 100; index++) {
      first.evalCommand(`text${index}="record ${index}"`);
      if (first.getObjectType(`text${index}`) !== "text")
        throw new Error(`GeoGebra did not create text${index}.`);
    }
    first.evalCommand(`gglatexEditorMetadataV1="${value}"`);
    first.setVisible("gglatexEditorMetadataV1", false);
    first.setAuxiliary("gglatexEditorMetadataV1", true);
    first.setFixed("gglatexEditorMetadataV1", true, false);
    const before = first.getValueString("gglatexEditorMetadataV1");
    const base64 = await new Promise<string>((resolve) =>
      first.getBase64(resolve),
    );
    const second = await mount();
    await new Promise<void>((resolve) => second.setBase64(base64, resolve));
    const managedCount = Array.from({ length: 100 }, (_, index) =>
      second.getObjectType(`text${index + 1}`),
    ).filter((type) => type === "text").length;
    return {
      before,
      after: second.getValueString("gglatexEditorMetadataV1"),
      type: second.getObjectType("gglatexEditorMetadataV1"),
      xml: second.getXML("gglatexEditorMetadataV1"),
      managedCount,
    };
  }, encoded);
  expect(observed.before).toBe(encoded);
  expect(observed.after).toBe(encoded);
  expect(decodeMetadata(observed.after)).toEqual(envelope);
  expect(observed.managedCount).toBe(100);
  expect(observed.type).toBe("text");
  expect(observed.xml).toContain('<auxiliary val="true"/>');
  expect(observed.xml).toContain('<selectionAllowed val="false"/>');
});
