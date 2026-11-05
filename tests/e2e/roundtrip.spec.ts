import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

test("creates, applies, downloads, reopens, and continues editing a Managed Text Object", async ({
  page,
}) => {
  test.slow();
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "New Managed Text" }).click();
  await expect(page.locator("#target-label")).toContainText(
    /Editing Target: text\d+/,
  );
  await expect(
    page.getByRole("checkbox", { name: "Clean signs and 1x coefficients" }),
  ).toBeChecked();
  const source = 'λ✓漢字 "quoted" \\alpha\n\\text{C++}';
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await editor.fill(source);
  await page.getByText("Advanced").click();
  await expect(page.getByLabel("Compiled Definition")).toContainText(
    "FormulaText(Simplify(",
  );
  await page
    .getByRole("checkbox", { name: "Clean signs and 1x coefficients" })
    .uncheck();
  await expect(page.getByLabel("Compiled Definition")).not.toContainText(
    "Simplify(",
  );
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .ggb" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("construction.ggb");
  const file = await download.path();
  expect(file).not.toBeNull();
  const xml = execFileSync("unzip", ["-p", file!, "geogebra.xml"], {
    encoding: "utf8",
  });
  const carrier = xml.match(
    /<element type="text" label="gglatexEditorMetadataV1">([\s\S]*?)<\/element>/,
  )?.[1];
  expect(carrier).toContain('<show object="false"');
  expect(carrier).toContain('<fixed val="true"/>');
  expect(carrier).toContain('<selectionAllowed val="false"/>');
  expect(carrier).toContain('<auxiliary val="true"/>');
  const reopened = await page.context().newPage();
  await reopened.goto("./");
  await expect(
    reopened.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready", { timeout: 90_000 });
  await reopened.locator("#file-input").setInputFiles(file!);
  await expect(reopened.locator("#target-label")).toContainText(
    /Editing Target: text\d+/,
    { timeout: 30_000 },
  );
  await expect
    .poll(() =>
      reopened
        .getByRole("textbox", { name: "Authoring Source" })
        .evaluate((element) => (element as HTMLElement).innerText),
    )
    .toBe(source);
  await expect(
    reopened.getByRole("checkbox", { name: "Clean signs and 1x coefficients" }),
  ).not.toBeChecked();
  await reopened
    .getByRole("textbox", { name: "Authoring Source" })
    .fill(source + " more");
  await expect(reopened.locator("#target-state")).toHaveText(
    "Draft Source has unapplied changes.",
  );
});
