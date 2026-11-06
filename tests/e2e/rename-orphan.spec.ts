import { expect, test } from "@playwright/test";

interface LiveApplet {
  evalCommand(command: string): boolean;
  renameObject(oldLabel: string, newLabel: string): boolean;
  deleteObject(label: string): void;
  setUndoPoint(): void;
  undo(): void;
  redo(): void;
  exists(label: string): boolean;
  getValueString(label: string): string;
}

test("target rename preserves the pinned draft and editor history", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "New Managed Text" }).click();
  const label = (await page.locator("#target-label").innerText()).replace(
    "Editing Target: ",
    "",
  );
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await editor.fill("my draft");
  await page.evaluate(
    (oldLabel) =>
      (
        window as typeof window & { ggbApplet: LiveApplet }
      ).ggbApplet.renameObject(oldLabel, "renamedText"),
    label,
  );
  await expect(page.locator("#target-label")).toHaveText(
    "Editing Target: renamedText",
  );
  await expect(editor).toHaveText("my draft");
  await editor.press("ControlOrMeta+z");
  await expect(editor).toBeEmpty();
});

test("external metadata replacement reports uncertainty and retains in-tab source", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "New Managed Text" }).click();
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await editor.fill("precious source");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
  await page.evaluate(() => {
    const empty = {
      application: "geogebra-latex-editor",
      schemaVersion: 1,
      languageVersion: 1,
      documents: {},
    };
    const encoded = btoa(JSON.stringify(empty))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.evalCommand(
      `gglatexEditorMetadataV1="${encoded}"`,
    );
  });
  await expect(page.locator("#target-label")).toContainText("Orphaned Source");
  await expect(page.locator("#interaction-state")).toContainText(
    "identity is uncertain",
  );
  await expect(editor).toHaveText("precious source");
  await expect(
    page.getByRole("button", { name: "Restore Orphaned Source as new text" }),
  ).toBeDisabled();
});

test("replacing a metadata record under the same ID retains the previous source", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "New Managed Text" }).click();
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await editor.fill("precious source");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
  await page.evaluate(() => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    const encoded = api.getValueString("gglatexEditorMetadataV1");
    const metadata = JSON.parse(
      atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
    ) as {
      documents: Record<
        string,
        { source: string; compiledFingerprint: string }
      >;
    };
    const document = Object.values(metadata.documents)[0]!;
    document.source = "foreign source";
    document.compiledFingerprint = "sha256:foreign";
    const replacement = btoa(JSON.stringify(metadata))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    api.evalCommand(`gglatexEditorMetadataV1="${replacement}"`);
  });
  await expect(page.locator("#target-label")).toContainText("Orphaned Source");
  await expect(editor).toHaveText("precious source");
  await expect(page.locator("#interaction-state")).toContainText(
    "identity is uncertain",
  );
});

test("reference rename and undo keep source metadata and draft coherent", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await page.evaluate(() =>
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.evalCommand(
      "a=2",
    ),
  );
  await page.getByRole("button", { name: "New Managed Text" }).click();
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await editor.fill("@a@");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
  const source = () =>
    page.evaluate(() => {
      const encoded = (
        window as typeof window & { ggbApplet: LiveApplet }
      ).ggbApplet.getValueString("gglatexEditorMetadataV1");
      const json = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
      const metadata = JSON.parse(json) as {
        documents: Record<string, { source: string }>;
      };
      return Object.values(metadata.documents)[0]?.source;
    });
  await page.evaluate(() =>
    (
      window as typeof window & { ggbApplet: LiveApplet }
    ).ggbApplet.renameObject("a", "b"),
  );
  await expect.poll(source).toBe("@b@");
  await expect(editor).toHaveText("@b@");
  await page.evaluate(() =>
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.undo(),
  );
  await expect.poll(source).toBe("@a@");
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.exists(
          "a",
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() =>
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.redo(),
  );
  await expect.poll(source).toBe("@b@");
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.exists(
          "b",
        ),
      ),
    )
    .toBe(true);
  await editor.fill("draft @b@");
  await page.evaluate(() =>
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.undo(),
  );
  await expect(editor).toHaveText("draft @a@");
  await expect(page.locator("#target-state")).not.toContainText("Diverged");
  await page.evaluate(() =>
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.redo(),
  );
  await expect(editor).toHaveText("draft @b@");
});

test("target deletion retains Orphaned Source and restores a new managed target", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "New Managed Text" }).click();
  const label = (await page.locator("#target-label").innerText()).replace(
    "Editing Target: ",
    "",
  );
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await editor.fill("recover me");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
  await page.evaluate((target) => {
    (
      window as typeof window & { ggbApplet: LiveApplet }
    ).ggbApplet.deleteObject(target);
    (
      window as typeof window & { ggbApplet: LiveApplet }
    ).ggbApplet.setUndoPoint();
  }, label);
  await expect(page.locator("#target-label")).toHaveText(
    `Orphaned Source: ${label}`,
  );
  await expect(editor).toHaveText("recover me");
  await page.evaluate(() =>
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.undo(),
  );
  await expect(page.locator("#target-label")).toHaveText(
    `Editing Target: ${label}`,
  );
  await page.evaluate(() =>
    (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet.redo(),
  );
  await expect(page.locator("#target-label")).toHaveText(
    `Orphaned Source: ${label}`,
  );
  await page.getByRole("button", { name: "New Managed Text" }).click();
  await page
    .getByRole("button", { name: `Open Orphaned Source: ${label}` })
    .click();
  await expect(page.locator("#target-label")).toHaveText(
    `Orphaned Source: ${label}`,
  );
  await page
    .getByRole("button", { name: "Restore Orphaned Source as new text" })
    .click();
  await expect(page.locator("#target-label")).toContainText("Editing Target: ");
  await expect(editor).toHaveText("recover me");
});
