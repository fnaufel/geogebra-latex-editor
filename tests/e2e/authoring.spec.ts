import { expect, test } from "@playwright/test";

test("draft editing shows diagnostics and a one-line definition without evaluating GeoGebra", async ({
  page,
}) => {
  await page.route("https://www.geogebra.org/apps/deployggb.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.GGBApplet = class {
        constructor(params) { this.params = params; }
        setHTML5Codebase() {}
        inject() { this.params.appletOnLoad({
          getVersion: () => '5.4.920.0', setWidth() {}, setHeight() {},
          getAllObjectNames: () => ['a', 'P', 'u_1', 'flag'],
          getObjectType: (label) => ({a:'number',P:'point',u_1:'vector',flag:'boolean'})[label] || '',
          isDefined: (label) => label !== 'flag',
          evalCommand: () => { throw new Error('Draft evaluated GeoGebra'); }
        }); }
      };`,
    }),
  );
  await page.goto("./");
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await editor.fill("@a@ + @missing@");
  await expect(
    page.getByText("missing is not in this construction."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Error.*characters 8–14/ }),
  ).toBeVisible();
  await editor.fill('@a@ \\text{C++} "yes"');
  await expect(page.locator(".cm-interpolation")).toHaveCount(1);
  await expect(page.locator(".cm-latex-command")).toHaveCount(1);
  await page.getByText("Advanced").click();
  await expect(page.getByLabel("Compiled Definition")).toContainText(
    'FormulaText(Simplify(FormulaText((a))+" \\text{C++} "+UnicodeToLetter(34)+"yes"+UnicodeToLetter(34)))',
  );
  await page
    .getByRole("checkbox", { name: "Clean signs and 1x coefficients" })
    .uncheck();
  await expect(page.getByLabel("Compiled Definition")).toContainText(
    'FormulaText(FormulaText((a))+" \\text{C++} "+UnicodeToLetter(34)+"yes"+UnicodeToLetter(34))',
  );
  await editor.fill("@Fr");
  await editor.press("Control+Space");
  await expect(
    page.getByRole("option", { name: "FractionText" }),
  ).toBeVisible();
  await editor.fill("@P");
  await editor.press("Control+Space");
  await expect(page.getByRole("option", { name: /P.*point/ })).toBeVisible();
  await editor.fill("@u_");
  await editor.press("Control+Space");
  await expect(page.getByRole("option", { name: /u_1.*vector/ })).toBeVisible();
  await editor.fill("@De");
  await editor.press("Control+Space");
  await expect(page.getByRole("option", { name: /Delete/ })).toHaveCount(0);
  await editor.fill("@si");
  await editor.press("Control+Space");
  await expect(
    page.getByRole("option", { name: "sin", exact: true }),
  ).toBeVisible();
  await editor.fill("@ra");
  await editor.press("Control+Space");
  await expect(page.getByRole("option", { name: /random/ })).toHaveCount(0);
  await editor.fill("\\fra");
  await editor.press("Control+Space");
  await expect(page.getByRole("option", { name: "\\frac" })).toBeVisible();
  await editor.fill("@a ");
  await editor.press("Control+Space");
  await expect(page.getByRole("option", { name: "FractionText" })).toHaveCount(
    0,
  );
  await editor.fill("@a + Fr");
  await editor.press("Control+Space");
  await expect(
    page.getByRole("option", { name: "FractionText" }),
  ).toBeVisible();
  await editor.fill('@Text("Fr');
  await editor.press("Control+Space");
  await expect(page.getByRole("option", { name: "FractionText" })).toHaveCount(
    0,
  );
});
