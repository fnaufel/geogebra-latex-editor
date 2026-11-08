import { expect, test, type Page } from "@playwright/test";

interface LiveApplet {
  evalCommand(command: string): boolean;
  getCommandString(label: string, localized: boolean): string;
  getValueString(label: string): string;
}

function readAppliedState(page: Page, label: string) {
  return page.evaluate((target) => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    return {
      command: api.getCommandString(target, false),
      value: api.getValueString(target),
      metadata: api.getValueString("gglatexEditorMetadataV1"),
    };
  }, label);
}

test("syntax, missing, undefined, and Apply failures preserve the last applied text", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready (5.4.920.0)", { timeout: 90_000 });
  await page.evaluate(() => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    api.evalCommand("a=2");
    api.evalCommand("u=sqrt(-1)");
  });
  await page.getByRole("button", { name: "New Managed Text" }).click();
  const label = (await page.locator("#target-label").innerText()).replace(
    "Editing Target: ",
    "",
  );
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await editor.fill("@a@");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
  const before = await readAppliedState(page, label);

  await editor.fill("@a");
  await expect(
    page.getByRole("button", { name: /Error.*Close the interpolation with @/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply", exact: true }),
  ).toBeDisabled();
  await editor.fill("@missing@");
  await expect(
    page.getByRole("button", {
      name: /Error.*missing is not in this construction/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply", exact: true }),
  ).toBeDisabled();
  await editor.fill("@u@");
  await expect(
    page.getByRole("button", { name: /Warning.*undefined/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply", exact: true }),
  ).toBeEnabled();
  expect(await readAppliedState(page, label)).toEqual(before);

  await editor.fill("runtime failure draft");
  await page.evaluate(() => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    const original = api.evalCommand.bind(api);
    api.evalCommand = (command: string) =>
      original(command.includes("\n") ? command.split("\n")[0]! : command);
  });
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toContainText(
    "[APPLY_ROLLED_BACK/APPLY_METADATA_FAILED]",
  );
  await expect(editor).toHaveText("runtime failure draft");
  expect(await readAppliedState(page, label)).toEqual(before);
});
