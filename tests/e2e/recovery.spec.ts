import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

async function ready(page: Page) {
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
}

async function interruptWithDraft(page: Page, source: string) {
  await ready(page);
  await page.getByRole("button", { name: "New Managed Text" }).click();
  await page.getByRole("textbox", { name: "Authoring Source" }).fill(source);
  await expect(
    page.getByText("Draft Source has unapplied changes."),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
}

test("offers an interrupted local draft without exposing or applying it until chosen", async ({
  page,
}) => {
  test.slow();
  await interruptWithDraft(page, "Draft after reload");
  await expect(
    page.getByRole("button", { name: /Local recovery \(1\)/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Local recovery \(1\)/ }).click();
  const dialog = page.getByRole("dialog", { name: "Local recovery" });
  await expect(dialog).toContainText("1 Recovery Draft");
  await expect(dialog).not.toContainText("Draft after reload");
  await dialog
    .getByRole("button", { name: "Restore snapshot and drafts" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Authoring Source" }),
  ).toHaveText("Draft after reload");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "matches the construction snapshot" }),
  ).toBeVisible();
  await expect(
    page.getByText("Draft Source has unapplied changes."),
  ).toBeVisible();
});

test("clears local recovery explicitly and reports removed bytes", async ({
  page,
}) => {
  test.slow();
  await interruptWithDraft(page, "Clear this draft");
  await expect(
    page.getByRole("button", { name: /Local recovery \(1\)/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Local recovery \(1\)/ }).click();
  let clearance = "";
  page.once("dialog", (dialog) => {
    clearance = dialog.message();
    void dialog.accept();
  });
  await page
    .getByRole("dialog", { name: "Local recovery" })
    .getByRole("button", { name: "Clear local recovery data" })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Cleared \d+ local recovery records \(\d+ bytes\)/ }),
  ).toBeVisible();
  expect(clearance).toMatch(/Clear \d+ local recovery records \(\d+ bytes\)/);
  await expect(
    page.getByRole("button", { name: "Local recovery (0)" }),
  ).toBeVisible();
});

test("warns related tabs without copying either tab's Draft Source", async ({
  page,
  context,
}) => {
  test.slow();
  await ready(page);
  await page.getByRole("button", { name: "New Managed Text" }).click();
  await page
    .getByRole("textbox", { name: "Authoring Source" })
    .fill("Applied text");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .ggb" }).click();
  await page
    .getByRole("dialog", { name: "Download construction" })
    .getByRole("button", { name: "Download .ggb" })
    .click();
  const download = await downloading;
  const file = await readFile(await download.path());
  const other = await context.newPage();
  await ready(other);
  const choosing = other.waitForEvent("filechooser");
  await other.getByRole("button", { name: "Open .ggb" }).click();
  const chooser = await choosing;
  await chooser.setFiles({
    name: "shared.ggb",
    mimeType: "application/vnd.geogebra.file",
    buffer: file,
  });
  await expect(
    other
      .getByRole("status")
      .filter({ hasText: "Another tab has this construction open" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Another tab has this construction open" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Authoring Source" })
    .fill("Only in first tab");
  await expect(
    other.getByRole("textbox", { name: "Authoring Source" }),
  ).toHaveText("Applied text");
  await other.close();
});

test("recovers a native construction edit after an immediate reload", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  page.on("dialog", (dialog) => void dialog.accept());
  const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded" });
  void page
    .evaluate(() => {
      const applet = (
        window as typeof window & {
          ggbApplet: { evalCommand(command: string): boolean };
        }
      ).ggbApplet;
      applet.evalCommand("a=1");
      location.reload();
    })
    .catch(() => {});
  await navigation;
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await expect(
    page.getByRole("button", { name: /Local recovery \(1\)/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Local recovery \(1\)/ }).click();
  await page
    .getByRole("dialog", { name: "Local recovery" })
    .getByRole("button", { name: "Restore snapshot and drafts" })
    .click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .ggb" }).click();
  await page
    .getByRole("dialog", { name: "Download construction" })
    .getByRole("button", { name: "Download .ggb" })
    .click();
  const download = await downloading;
  const entries = unzipSync(await readFile(await download.path()));
  expect(strFromU8(entries["geogebra.xml"]!)).toContain('label="a"');
});
