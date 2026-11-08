import { expect, test } from "@playwright/test";

test("keyboard authoring applies with the platform shortcut and restores editor focus", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "New Managed Text" }).click();
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await editor.fill("Keyboard formula");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Draft Source has unapplied changes." }),
  ).toBeVisible();
  await editor.press("ControlOrMeta+Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "Applied Source is current." }),
  ).toBeVisible();
  await expect(editor).toBeFocused();
});

test("toolbar, dialogs, splitter, and status regions follow a keyboard path", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready (5.4.920.0)", { timeout: 90_000 });
  const newConstruction = page.getByRole("button", {
    name: "New construction",
  });
  const newText = page.getByRole("button", { name: "New Managed Text" });
  const open = page.getByRole("button", { name: "Open .ggb" });
  const download = page.getByRole("button", { name: "Download .ggb" });
  const recovery = page.getByRole("button", { name: /Local recovery/ });
  await newConstruction.focus();
  await page.keyboard.press("Tab");
  await expect(newText).toBeFocused();
  await expect(newText).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Tab");
  await expect(open).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(download).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(recovery).toBeFocused();
  await recovery.press("Enter");
  const recoveryDialog = page.getByRole("dialog", { name: "Local recovery" });
  await expect(recoveryDialog).toBeVisible();
  await recoveryDialog.getByRole("button", { name: "Close" }).press("Enter");
  await expect(recovery).toBeFocused();

  await download.focus();
  await download.press("Enter");
  const downloadDialog = page.getByRole("dialog", {
    name: "Download construction",
  });
  await expect(downloadDialog).toBeVisible();
  await downloadDialog.getByRole("button", { name: "Cancel" }).press("Enter");
  await expect(download).toBeFocused();

  const splitter = page.getByRole("separator", {
    name: "Resize construction and editor panes",
  });
  await splitter.focus();
  await splitter.press("Home");
  await expect(splitter).toHaveAttribute("aria-valuenow", "20");
  await splitter.press("End");
  await expect(splitter).toHaveAttribute("aria-valuenow", "80");
  await expect(splitter).toHaveCSS("outline-style", "solid");
  await expect(page.locator("#target-state")).toHaveAttribute(
    "aria-live",
    "polite",
  );
  await expect(page.locator("#diagnostic-summary")).toHaveAttribute(
    "aria-live",
    "polite",
  );
});
