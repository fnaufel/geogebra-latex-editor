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
  await expect(page.getByRole("status").filter({ hasText: "Draft Source has unapplied changes." })).toBeVisible();
  await editor.press("ControlOrMeta+Enter");
  await expect(page.getByRole("status").filter({ hasText: "Applied Source is current." })).toBeVisible();
  await expect(editor).toBeFocused();
});
