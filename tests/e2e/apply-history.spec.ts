import { expect, test } from "@playwright/test";

interface LiveApplet {
  getXML(label?: string): string;
  setXML(xml: string): void;
  getCommandString(label: string, localized: boolean): string;
  getValueString(label: string): string;
  getCaption(label: string, substitutePlaceholders: boolean): string;
  setColor(label: string, red: number, green: number, blue: number): void;
  setLayer(label: string, layer: number): void;
  setCaption(label: string, caption: string): void;
  setLabelVisible(label: string, visible: boolean): void;
  setFixed(label: string, fixed: boolean, selectionAllowed: boolean): void;
  setVisible(label: string, visible: boolean): void;
  setLabelStyle(label: string, style: number): void;
  evalCommand(command: string): boolean;
  undo(): void;
  redo(): void;
}

test("Apply preserves presentation and moves source and definition through one undo/redo step", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "New Managed Text" }).click();
  const targetLabel = page.locator("#target-label");
  await expect(targetLabel).toContainText(/Editing Target: text\d+/);
  const label = (await targetLabel.textContent())!.replace(
    "Editing Target: ",
    "",
  );
  const read = () =>
    page.evaluate((label) => {
      const api = (window as typeof window & { ggbApplet: LiveApplet })
        .ggbApplet;
      return {
        targetXml: api.getXML(label),
        metadataXml: api.getXML("gglatexEditorMetadataV1"),
        command: api.getCommandString(label, false),
        metadata: api.getValueString("gglatexEditorMetadataV1"),
        caption: api.getCaption(label, false),
      };
    }, label);
  await page.evaluate((label) => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    api.setColor(label, 38, 84, 180);
    api.setLayer(label, 3);
    api.setCaption(label, "Styled caption");
    api.setLabelStyle(label, 3);
    api.setLabelVisible(label, true);
    api.setFixed(label, true, true);
    api.evalCommand(`SelectObjects(${label})`);
  }, label);
  await expect(page.locator("#selection-state")).toContainText(
    "Selected text:",
  );
  const before = await read();
  expect(before.caption).toBe("Styled caption");
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await editor.fill("first");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
  await expect(page.locator("#selection-state")).toContainText(
    "Selected text:",
  );
  const after = await read();
  expect(after.targetXml.slice(after.targetXml.indexOf("<element"))).toBe(
    before.targetXml.slice(before.targetXml.indexOf("<element")),
  );
  expect(after.metadataXml.slice(after.metadataXml.indexOf("<element"))).toBe(
    before.metadataXml.slice(before.metadataXml.indexOf("<element")),
  );
  expect(after.caption).toBe(before.caption);
  expect(after.command).not.toBe(before.command);
  expect(after.metadata).not.toBe(before.metadata);
  await page.evaluate(() =>
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.undo(),
  );
  await expect.poll(async () => (await read()).command).toBe(before.command);
  await expect.poll(async () => (await read()).metadata).toBe(before.metadata);
  await expect.poll(async () => (await editor.innerText()).trim()).toBe("");
  await page.evaluate(() =>
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.redo(),
  );
  await expect.poll(async () => (await read()).command).toBe(after.command);
  await expect.poll(async () => (await read()).metadata).toBe(after.metadata);
  await expect
    .poll(async () => (await editor.innerText()).trim())
    .toBe("first");
});

test("Apply retains hidden absolute-screen text and advanced font styling", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "New Managed Text" }).click();
  const label = (await page.locator("#target-label").textContent())!.replace(
    "Editing Target: ",
    "",
  );
  const before = await page.evaluate((label) => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    const construction = api.getXML();
    const element = new RegExp(
      `<element type="text" label="${label}">[\\s\\S]*?<\\/element>`,
    );
    const match = construction.match(element);
    if (!match) throw new Error("Target XML is missing.");
    const styled = match[0]
      .replace(
        /<startPoint[^>]*\/>/,
        '<absoluteScreenLocation x="120" y="80"/>',
      )
      .replace(
        "</element>",
        '<font serif="true" size="4" style="3"/><isLaTeX val="true"/></element>',
      );
    api.setXML(construction.replace(match[0], styled));
    api.setVisible(label, false);
    api.setLabelStyle(label, 3);
    api.setFixed(label, true, false);
    return api.getXML(label).slice(api.getXML(label).indexOf("<element"));
  }, label);
  expect(before).toContain("absoluteScreenLocation");
  expect(before).toContain("<font");
  expect(before).toContain("<isLaTeX");
  expect(before).toContain('object="false"');
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await editor.fill("styled");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
  const after = await page.evaluate((label) => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    const xml = api.getXML(label);
    return xml.slice(xml.indexOf("<element"));
  }, label);
  expect(after).toBe(before);
});

test("undo exposes a Diverged Draft and requires explicit discard", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "New Managed Text" }).click();
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await editor.fill("applied");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
  await editor.fill("my draft");
  await page.evaluate(() =>
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.undo(),
  );
  await expect(page.locator("#target-state")).toContainText("Diverged Draft");
  await expect
    .poll(async () => (await editor.innerText()).trim())
    .toBe("my draft");
  await expect(page.locator("#applied-source")).toHaveText("");
  await expect(
    page.getByRole("button", { name: "Reapply Draft" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discard Draft" }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
  await expect.poll(async () => (await editor.innerText()).trim()).toBe("");
});

test("failed grouped metadata write rolls back the applet and retains Draft Source", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "New Managed Text" }).click();
  const label = (await page.locator("#target-label").textContent())!.replace(
    "Editing Target: ",
    "",
  );
  const before = await page.evaluate((label) => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    const state = {
      command: api.getCommandString(label, false),
      metadata: api.getValueString("gglatexEditorMetadataV1"),
    };
    const original = api.evalCommand.bind(api);
    api.evalCommand = (command: string) =>
      original(command.includes("\n") ? command.split("\n")[0]! : command);
    return state;
  }, label);
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await editor.fill("keep this draft");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toContainText(
    "[APPLY_ROLLED_BACK/APPLY_METADATA_FAILED]",
  );
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "[APPLY_ROLLED_BACK/APPLY_METADATA_FAILED]" }),
  ).toBeVisible();
  await expect
    .poll(async () => (await editor.innerText()).trim())
    .toBe("keep this draft");
  const after = await page.evaluate((label) => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    return {
      command: api.getCommandString(label, false),
      metadata: api.getValueString("gglatexEditorMetadataV1"),
    };
  }, label);
  expect(after).toEqual(before);
});

test("failed rollback halts Apply and offers its snapshot and draft after reload", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "New Managed Text" }).click();
  const expectedSnapshot = await page.evaluate(() =>
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.getXML(),
  );
  await page.evaluate(() => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    const evaluate = api.evalCommand.bind(api);
    api.evalCommand = (command: string) =>
      evaluate(command.includes("\n") ? command.split("\n")[0]! : command);
    const restore = api.setXML.bind(api);
    let restorations = 0;
    api.setXML = (xml: string) => {
      restorations++;
      if (restorations !== 2) restore(xml);
    };
  });
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await editor.fill("recover me");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toContainText(
    "[APPLY_ROLLBACK_FAILED/APPLY_METADATA_FAILED]",
  );
  await expect(page.locator("#target-state")).toContainText(
    "Download the current construction if possible",
  );
  await expect
    .poll(async () => (await editor.innerText()).trim())
    .toBe("recover me");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toContainText(
    "Further Apply is disabled",
  );
  const [otherTab] = await Promise.all([
    page.context().waitForEvent("page"),
    page.evaluate(() => {
      window.open(location.href, "_blank");
    }),
  ]);
  await expect(
    otherTab.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await expect(
    otherTab.getByRole("button", { name: "Restore failed Apply draft" }),
  ).toBeHidden();
  await otherTab.close();
  await page.reload();
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  const recover = page.getByRole("button", {
    name: "Restore failed Apply draft",
  });
  await expect(recover).toBeVisible();
  await page.evaluate(() => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    (
      window as typeof window & { restoreSetXML?: (xml: string) => void }
    ).restoreSetXML = api.setXML.bind(api);
    api.setXML = () => {};
  });
  page.once("dialog", (dialog) => dialog.accept());
  await recover.click();
  await expect(page.locator("#target-state")).toContainText(
    "Recovered construction did not match the snapshot",
  );
  await expect(recover).toBeVisible();
  await page.evaluate(() => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    api.setXML = (
      window as typeof window & { restoreSetXML: (xml: string) => void }
    ).restoreSetXML;
  });
  page.once("dialog", (dialog) => dialog.accept());
  await recover.click();
  await expect(page.locator("#target-label")).toContainText("Editing Target:");
  await expect
    .poll(async () => (await editor.innerText()).trim())
    .toBe("recover me");
  await expect(page.locator("#target-state")).toContainText(
    "Draft Source has unapplied changes",
  );
  await expect(recover).toBeHidden();
  expect(
    await page.evaluate(() =>
      (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.getXML(),
    ),
  ).toBe(expectedSnapshot);
});
