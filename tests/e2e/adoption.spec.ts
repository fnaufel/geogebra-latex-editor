import { expect, test } from "@playwright/test";

interface LiveApplet {
  evalCommand(command: string): boolean;
  getXML(label: string): string;
  getCommandString(label: string, localized: boolean): string;
  getValueString(label: string): string;
  getObjectType(label: string): string;
  setColor(label: string, red: number, green: number, blue: number): void;
  setLayer(label: string, layer: number): void;
  setCoords(label: string, x: number, y: number): void;
  setCaption(label: string, caption: string): void;
  setLabelVisible(label: string, visible: boolean): void;
  setFixed(label: string, fixed: boolean, selectionAllowed: boolean): void;
  setUndoPoint(): void;
  undo(): void;
  redo(): void;
}

test("Adoption snapshots literal at signs without changing styled positioned text and has one undo step", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  const before = await page.evaluate(() => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    api.evalCommand('u="mail@example.com"');
    api.setCoords("u", 3, 4);
    api.setColor("u", 36, 84, 180);
    api.setLayer("u", 3);
    api.setCaption("u", "Styled caption");
    api.setLabelVisible("u", true);
    api.setFixed("u", true, true);
    api.setUndoPoint();
    const state = {
      xml: api.getXML("u"),
      command: api.getCommandString("u", false),
      rendered: api.getValueString("u"),
    };
    api.evalCommand("SelectObjects(u)");
    return state;
  });
  expect(before.rendered).toBe("mail@example.com");
  await page.getByRole("button", { name: "Edit selected text" }).click();
  await expect(
    page.getByRole("region", { name: "Rendered LaTeX snapshot" }),
  ).toHaveText("mail@example.com");
  await expect(
    page.getByRole("textbox", { name: "Authoring Source" }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Apply", exact: true }),
  ).toBeDisabled();
  const adopt = page.getByRole("button", { name: "Adopt text" });
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("literal snapshot");
    expect(dialog.message()).toContain(
      "dynamic dependencies cannot be reconstructed",
    );
    await dialog.dismiss();
  });
  await adopt.click();
  await expect(adopt).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Rendered LaTeX snapshot" }),
  ).toHaveText("mail@example.com");
  page.once("dialog", (dialog) => dialog.accept());
  await adopt.click();
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await expect(editor).toHaveText("mail@@example.com");
  await expect(page.locator("#selection-state")).toContainText(
    "Selected text: u",
  );
  await expect(
    page.getByRole("checkbox", { name: "Clean signs and 1x coefficients" }),
  ).not.toBeChecked();
  const after = await page.evaluate(() => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    return {
      xml: api.getXML("u"),
      command: api.getCommandString("u", false),
      rendered: api.getValueString("u"),
      metadata: api.getValueString("gglatexEditorMetadataV1"),
    };
  });
  expect(after.xml).toBe(before.xml);
  expect(after.command).toBe(before.command);
  expect(after.rendered).toBe(before.rendered);
  const envelope = JSON.parse(
    atob(after.metadata.replace(/-/g, "+").replace(/_/g, "/")),
  ) as { documents: Record<string, { source: string; simplify: boolean }> };
  expect(Object.values(envelope.documents)).toEqual([
    expect.objectContaining({ source: "mail@@example.com", simplify: false }),
  ]);
  await editor.fill("unapplied revision");
  await page.evaluate(() =>
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.undo(),
  );
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (
          window as typeof window & { ggbApplet: LiveApplet }
        ).ggbApplet.getObjectType("gglatexEditorMetadataV1"),
      ),
    )
    .not.toBe("text");
  await expect(adopt).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Rendered LaTeX snapshot" }),
  ).toHaveText("mail@example.com");
  await expect(
    page.getByRole("region", { name: "Draft Source retained after undo" }),
  ).toHaveText("unapplied revision");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Unapplied Draft Source");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Download .ggb" }).click();
  await page.evaluate(() =>
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.redo(),
  );
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (
          window as typeof window & { ggbApplet: LiveApplet }
        ).ggbApplet.getValueString("gglatexEditorMetadataV1"),
      ),
    )
    .toBe(after.metadata);
  await expect(editor).toHaveText("unapplied revision");
  expect(
    await page.evaluate(() =>
      (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.getXML(
        "u",
      ),
    ),
  ).toBe(before.xml);
});

test("adopted dynamic text keeps its definition until an explicit edit is applied", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "New Managed Text" }).click();
  const before = await page.evaluate(() => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    api.evalCommand("a=2");
    api.evalCommand('u=FormulaText("value="+FormulaText((a)))');
    api.setUndoPoint();
    const state = {
      command: api.getCommandString("u", false),
      rendered: api.getValueString("u"),
    };
    api.evalCommand("SelectObjects(u)");
    return state;
  });
  await page.getByRole("button", { name: "Edit selected text" }).click();
  await expect(
    page.getByRole("region", { name: "Rendered LaTeX snapshot" }),
  ).toHaveText(before.rendered);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Adopt text" }).click();
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await expect(editor).toHaveText(before.rendered);
  expect(
    await page.evaluate(() =>
      (
        window as typeof window & { ggbApplet: LiveApplet }
      ).ggbApplet.getCommandString("u", false),
    ),
  ).toBe(before.command);
  await editor.fill(`${before.rendered}!`);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
  await page.evaluate(() =>
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.undo(),
  );
  await expect(editor).toHaveText(before.rendered);
  expect(
    await page.evaluate(() =>
      (
        window as typeof window & { ggbApplet: LiveApplet }
      ).ggbApplet.getCommandString("u", false),
    ),
  ).toBe(before.command);
  await page.evaluate(() =>
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.redo(),
  );
  await expect(editor).toHaveText(`${before.rendered}!`);
});

test("Adoption refuses an unsupported newer metadata envelope", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  const encoded = await page.evaluate(() => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    const value = btoa(
      JSON.stringify({
        application: "geogebra-latex-editor",
        schemaVersion: 2,
        languageVersion: 1,
        documents: {},
      }),
    );
    api.evalCommand(`gglatexEditorMetadataV1="${value}"`);
    api.evalCommand('u="original"');
    api.setUndoPoint();
    api.evalCommand("SelectObjects(u)");
    return value;
  });
  await page.getByRole("button", { name: "Edit selected text" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Adopt text" }).click();
  await expect(page.locator("#target-state")).toContainText(
    "newer Authoring Source metadata",
  );
  await expect(page.getByRole("button", { name: "Adopt text" })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const api = (window as typeof window & { ggbApplet: LiveApplet })
        .ggbApplet;
      return {
        original: api.getValueString("gglatexEditorMetadataV1"),
        extra: api.getObjectType("gglatexEditorMetadata_1"),
      };
    }),
  ).toEqual({ original: encoded, extra: "" });
});
