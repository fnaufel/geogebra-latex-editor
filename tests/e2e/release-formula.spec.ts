import { expect, test } from "@playwright/test";

interface LiveApplet {
  evalCommand(command: string): boolean;
  getValueString(label: string): string;
}

test("the motivating formula updates when its construction values change", async ({
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
    api.evalCommand("b=3");
  });
  await page.getByRole("button", { name: "New Managed Text" }).click();
  const label = (await page.locator("#target-label").innerText()).replace(
    "Editing Target: ",
    "",
  );
  const source =
    "@a@ x^2 + @b@ x = @a@ \\left( x^2 + @FractionText(b/a)@ x \\right)";
  await page.getByRole("textbox", { name: "Authoring Source" }).fill(source);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator("#target-state")).toHaveText(
    "Applied Source is current.",
  );
  const before = await page.evaluate((target) => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    return api.getValueString(target);
  }, label);
  await page.evaluate(() => {
    const api = (window as typeof window & { ggbApplet: LiveApplet }).ggbApplet;
    api.evalCommand("b=4");
  });
  await expect
    .poll(() =>
      page.evaluate((target) => {
        const api = (window as typeof window & { ggbApplet: LiveApplet })
          .ggbApplet;
        return api.getValueString(target);
      }, label),
    )
    .not.toBe(before);
  await expect(page.getByRole("textbox", { name: "Authoring Source" })).toHaveText(
    source,
  );
});
