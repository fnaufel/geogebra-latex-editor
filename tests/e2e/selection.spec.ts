import { expect, test } from "@playwright/test";

test("pins a live text selection and inserts a different object once", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  const selected = page.getByRole("button", { name: "Edit selected text" });
  await expect(selected).toBeDisabled();
  await page.getByRole("button", { name: "New Managed Text" }).click();
  const label = (await page.locator("#target-label").innerText()).replace(
    "Editing Target: ",
    "",
  );
  await editor.fill("before after");
  await page.evaluate(() => {
    const api = (
      window as unknown as {
        ggbApplet: { evalCommand: (command: string) => boolean };
      }
    ).ggbApplet;
    api.evalCommand("a=2");
    api.evalCommand("b=3");
    api.evalCommand('u="unmanaged"');
    api.evalCommand("SelectObjects(a)");
  });
  await expect(page.locator("#selection-state")).toContainText(
    "not a text object",
  );
  await expect(selected).toBeDisabled();
  await expect(page.locator("#target-label")).toHaveText(
    `Editing Target: ${label}`,
  );
  await expect(editor).toHaveText("before after");
  await page.evaluate(() => {
    (
      window as unknown as {
        ggbApplet: { evalCommand: (command: string) => boolean };
      }
    ).ggbApplet.evalCommand("SelectObjects(u)");
  });
  await expect(page.locator("#selection-state")).toContainText(
    "Unmanaged Text Object",
  );
  await expect(selected).toBeDisabled();
  await page.evaluate((textLabel) => {
    (
      window as unknown as {
        ggbApplet: { evalCommand: (command: string) => boolean };
      }
    ).ggbApplet.evalCommand(`SelectObjects(${textLabel})`);
  }, label);
  await expect(selected).toBeEnabled();
  await selected.click();
  await expect(page.locator("#interaction-state")).toContainText(
    `pinned to ${label}`,
  );
  await editor.click();
  await editor.press("Home");
  await page.getByRole("button", { name: "Insert Object" }).click();
  await page.evaluate(() => {
    (
      window as unknown as {
        ggbApplet: { evalCommand: (command: string) => boolean };
      }
    ).ggbApplet.evalCommand("SelectObjects(a)");
  });
  await expect(editor).toHaveText("@a@before after");
  await expect(
    page.getByRole("button", { name: "Cancel insertion" }),
  ).toBeHidden();
  await expect(page.locator("#interaction-state")).toContainText("Inserted a");
  await page.getByRole("button", { name: "Insert Object" }).click();
  await page.evaluate(() => {
    (
      window as unknown as {
        ggbApplet: { evalCommand: (command: string) => boolean };
      }
    ).ggbApplet.evalCommand("SelectObjects(a,b)");
  });
  await expect(page.locator("#interaction-state")).toContainText(
    "exactly one object",
  );
  await expect(
    page.getByRole("button", { name: "Cancel insertion" }),
  ).toBeVisible();
  await expect(editor).toHaveText("@a@before after");
  await page.getByRole("button", { name: "Cancel insertion" }).click();
  await expect(editor).toHaveText("@a@before after");
  await editor.fill("@");
  await editor.press("ControlOrMeta+Space");
  await expect(
    page.getByRole("option", { name: /a.*numeric.*defined/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: /b.*numeric.*defined/ }),
  ).toBeVisible();
  await page.getByRole("option", { name: /b.*numeric.*defined/ }).click();
  await expect(editor).toHaveText("@b");
});

test("switching managed texts restores each draft and its editor undo history", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  const create = page.getByRole("button", { name: "New Managed Text" });
  await create.click();
  const first = (await page.locator("#target-label").innerText()).replace(
    "Editing Target: ",
    "",
  );
  await editor.fill("first draft");
  await create.click();
  const second = (await page.locator("#target-label").innerText()).replace(
    "Editing Target: ",
    "",
  );
  expect(second).not.toBe(first);
  await editor.fill("second draft");
  await page.evaluate((label) => {
    (
      window as unknown as {
        ggbApplet: { evalCommand: (command: string) => boolean };
      }
    ).ggbApplet.evalCommand(`SelectObjects(${label})`);
  }, first);
  await page.getByRole("button", { name: "Edit selected text" }).click();
  await expect(editor).toHaveText("first draft");
  await editor.press("ControlOrMeta+z");
  await expect(editor).toBeEmpty();
  await page.evaluate((label) => {
    (
      window as unknown as {
        ggbApplet: { evalCommand: (command: string) => boolean };
      }
    ).ggbApplet.evalCommand(`SelectObjects(${label})`);
  }, second);
  await page.getByRole("button", { name: "Edit selected text" }).click();
  await expect(editor).toHaveText("second draft");
  await editor.press("ControlOrMeta+z");
  await expect(editor).toBeEmpty();
});
