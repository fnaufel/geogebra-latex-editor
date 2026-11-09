import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function ready(page: Page) {
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
}

async function makeText(page: Page, source = "Applied text") {
  await page.getByRole("button", { name: "New Managed Text" }).click();
  await expect(page.locator("#target-label")).toContainText(
    /Editing Target: text\d+/,
  );
  await page.getByRole("textbox", { name: "Authoring Source" }).fill(source);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
}

async function download(page: Page, choice: "apply" | "applied" = "applied") {
  const result = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .ggb" }).click();
  const dialog = page.getByRole("dialog", { name: "Download construction" });
  await dialog
    .getByRole("radio", {
      name:
        choice === "apply"
          ? "Apply all valid drafts"
          : "Download applied construction only",
    })
    .check();
  await dialog.getByRole("button", { name: "Download .ggb" }).click();
  const saved = await result;
  await expect(page.locator("#download-file")).toBeEnabled();
  return saved;
}

test("New distinguishes Draft Sources and Dirty Construction and unload warns only for work at risk", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  const atRisk = () =>
    page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(await atRisk()).toBe(false);
  await makeText(page);
  const label = (await page.locator("#target-label").innerText()).replace(
    "Editing Target: ",
    "",
  );
  await page.evaluate(
    (selected) =>
      (
        window as typeof window & {
          ggbApplet: { evalCommand(command: string): boolean };
        }
      ).ggbApplet.evalCommand(`SelectObjects(${selected})`),
    label,
  );
  await expect(
    page.getByRole("button", { name: "Edit selected text" }),
  ).toBeEnabled();
  await expect(page.locator("#construction-state")).toContainText(
    "Dirty Construction",
  );
  expect(await atRisk()).toBe(true);
  await page
    .getByRole("textbox", { name: "Authoring Source" })
    .fill("Unapplied draft");
  const prompts: string[] = [];
  const responses = [false, true, false, true, true];
  page.on("dialog", async (dialog) => {
    prompts.push(dialog.message());
    if (responses.shift()) await dialog.accept();
    else await dialog.dismiss();
  });
  await page.getByRole("button", { name: "New construction" }).click();
  await expect(
    page.getByRole("textbox", { name: "Authoring Source" }),
  ).toHaveText("Unapplied draft");
  await page.getByRole("button", { name: "New construction" }).click();
  await expect(page.locator("#target-label")).toContainText("Editing Target");
  await page.getByRole("button", { name: "New construction" }).click();
  await expect(page.locator("#target-label")).toHaveText("No Editing Target");
  await expect(page.locator("#new-construction")).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Edit selected text" }),
  ).toBeDisabled();
  await expect(page.locator("#construction-state")).toHaveText(
    "Construction current",
  );
  expect(await atRisk()).toBe(false);
  expect(
    prompts.filter((message) =>
      message.startsWith("New will discard unapplied Draft Sources"),
    ),
  ).toHaveLength(3);
  expect(
    prompts.filter((message) =>
      message.startsWith("New will discard Dirty Construction"),
    ),
  ).toHaveLength(2);
});

test("Download offers cancel, Apply all valid drafts, and applied construction only", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await makeText(page);
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await editor.fill("Valid draft");
  await page.getByRole("button", { name: "Download .ggb" }).click();
  const dialog = page.getByRole("dialog", { name: "Download construction" });
  await expect(dialog).toContainText("text1: valid Draft Source");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Draft Source has unapplied changes.",
  );
  const applied = await download(page, "apply");
  expect(applied.suggestedFilename()).toBe("construction.ggb");
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
  await editor.fill("Another valid draft");
  const appliedOnly = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .ggb" }).click();
  await dialog.getByRole("textbox", { name: "Filename" }).fill("version-2");
  await dialog.getByRole("button", { name: "Download .ggb" }).click();
  expect((await appliedOnly).suggestedFilename()).toBe("version-2.ggb");
  await expect(page.locator("#download-file")).toBeEnabled();
  await expect(page.locator("#filename")).toHaveText("version-2.ggb");
  await expect(page.locator("#target-state")).toHaveText(
    "Draft Source has unapplied changes.",
  );
  await editor.fill("@missing@");
  await page.getByRole("button", { name: "Download .ggb" }).click();
  await expect(dialog).toContainText("text1: invalid Draft Source");
  await dialog.getByRole("radio", { name: "Apply all valid drafts" }).check();
  const invalidDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download .ggb" }).click();
  await invalidDownload;
  await expect(page.locator("#target-state")).toHaveText(
    "Draft Source has unapplied changes.",
  );
  await expect(page.locator("#construction-state")).toHaveText(
    "Construction current",
  );
});

test("reapplies an already applied text", async ({ page }) => {
  await ready(page);
  await makeText(page);
  await page
    .getByRole("textbox", { name: "Authoring Source" })
    .fill("Valid draft");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
});

test("Open stages good files, rejects corrupt files, and honors canceled replacement", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await makeText(page, "Saved source");
  await page.evaluate(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    Object.defineProperty(crypto.subtle, "digest", {
      configurable: true,
      value: async (...args: Parameters<typeof crypto.subtle.digest>) => {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return digest(...args);
      },
    });
  });
  const saved = await download(page);
  expect(await page.locator("#construction-state").innerText()).toBe(
    "Construction current",
  );
  const savedPath = await saved.path();
  if (!savedPath) throw new Error("Download path unavailable.");
  const lesson = {
    name: "lesson.ggb",
    mimeType: "application/vnd.geogebra.file",
    buffer: await readFile(savedPath),
  };
  const originalLabel = await page.locator("#target-label").innerText();
  await page.evaluate(
    (selected) =>
      (
        window as typeof window & {
          ggbApplet: { evalCommand(command: string): boolean };
        }
      ).ggbApplet.evalCommand(`SelectObjects(${selected})`),
    originalLabel.replace("Editing Target: ", ""),
  );
  await expect(
    page.getByRole("button", { name: "Edit selected text" }),
  ).toBeEnabled();
  await expect(page.locator("#construction-state")).toHaveText(
    "Construction current",
  );
  await page.locator("#file-input").setInputFiles({
    name: "bad.ggb",
    mimeType: "application/vnd.geogebra.file",
    buffer: Buffer.from("corrupt"),
  });
  await expect(page.locator("#target-state")).toContainText(
    "FILE_OPERATION_FAILED",
  );
  await expect(page.locator("#target-label")).toHaveText(originalLabel);
  await expect(page.locator("#filename")).toHaveText("construction.ggb");
  await page
    .getByRole("textbox", { name: "Authoring Source" })
    .fill("Local draft");
  const messages: string[] = [];
  page.on("dialog", async (dialog) => {
    messages.push(dialog.message());
    await dialog.dismiss();
  });
  await page.locator("#file-input").setInputFiles(lesson);
  await expect(
    page.getByRole("textbox", { name: "Authoring Source" }),
  ).toHaveText("Local draft");
  await expect(page.locator("#filename")).toHaveText("construction.ggb");
  expect(messages).toHaveLength(1);
  page.removeAllListeners("dialog");
  page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#file-input").setInputFiles(lesson);
  await expect(page.locator("#filename")).toHaveText("lesson-edited.ggb");
  await expect(
    page.getByRole("textbox", { name: "Authoring Source" }),
  ).toHaveText("Saved source");
  await expect(
    page.getByRole("button", { name: "Edit selected text" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Authoring Source" })
    .fill("Edited after Open");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
});
