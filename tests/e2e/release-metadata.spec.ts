import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

interface LiveApplet {
  evalCommand(command: string): boolean;
  getBase64(callback: (base64: string) => void): void;
}

async function openConstructionWithMetadata(
  context: BrowserContext,
  encoded: string,
) {
  const sourcePage = await context.newPage();
  await sourcePage.goto("./");
  await expect(
    sourcePage.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready (5.4.920.0)", { timeout: 90_000 });
  const base64 = await sourcePage.evaluate(async (value) => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    api.evalCommand('u="preserved text"');
    api.evalCommand(`gglatexEditorMetadataV1="${value}"`);
    return new Promise<string>((resolve) => api.getBase64(resolve));
  }, encoded);
  await sourcePage.close();

  const page = await context.newPage();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready (5.4.920.0)", { timeout: 90_000 });
  await page.locator("#file-input").setInputFiles({
    name: "metadata-case.ggb",
    mimeType: "application/vnd.geogebra.file",
    buffer: Buffer.from(base64, "base64"),
  });
  await expect(page.locator("#filename")).toHaveText(
    "metadata-case-edited.ggb",
  );
  await expect(
    page.getByRole("treeitem").filter({ hasText: "preserved text" }),
  ).toBeVisible();
  return page;
}

async function expectCarrierUnchanged(page: Page, encoded: string) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .ggb" }).click();
  await page
    .getByRole("dialog", { name: "Download construction" })
    .getByRole("button", { name: "Download .ggb" })
    .click();
  const path = await (await download).path();
  if (!path) throw new Error("Downloaded construction path is unavailable.");
  const xml = execFileSync("unzip", ["-p", path, "geogebra.xml"], {
    encoding: "utf8",
  });
  expect(xml).toContain(encoded);
  expect(xml).not.toContain('label="gglatexEditorMetadata_1"');
}

async function exerciseGeoGebraHistory(page: Page) {
  const applet = page.locator("#ggb-element");
  await applet.getByRole("listitem").nth(1).click({ timeout: 5_000 });
  await applet.locator("canvas").click({
    position: { x: 80, y: 80 },
  });
  await expect(
    page.getByRole("treeitem").filter({ hasText: /A =/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(
    page.getByRole("treeitem").filter({ hasText: /A =/ }),
  ).toHaveCount(0);
}

test("opening corrupt metadata keeps the construction usable and preserves its carrier", async ({
  context,
}) => {
  test.slow();
  const page = await openConstructionWithMetadata(context, "not-base64url?");
  await expect(page.locator("#target-state")).toContainText(
    "[METADATA_MALFORMED]",
  );
  await exerciseGeoGebraHistory(page);
  await expectCarrierUnchanged(page, "not-base64url?");
});

test("opening newer metadata keeps its bytes unchanged and reports incompatibility", async ({
  context,
}) => {
  test.slow();
  const encoded = Buffer.from(
    JSON.stringify({
      application: "geogebra-latex-editor",
      schemaVersion: 2,
      languageVersion: 1,
      documents: {},
    }),
  ).toString("base64url");
  const page = await openConstructionWithMetadata(context, encoded);
  await expect(page.locator("#target-state")).toContainText("[METADATA_NEWER]");
  await exerciseGeoGebraHistory(page);
  await expectCarrierUnchanged(page, encoded);
});
