import { expect, test } from "@playwright/test";

test("loads the pinned GeoGebra Classic applet and exposes its toolbar", async ({
  page,
}) => {
  test.slow();
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.push(error.message));
  page.on("requestfailed", (request) =>
    diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      diagnostics.push(`${response.status()} ${response.url()}`);
  });
  await page.goto("./");
  const status = page.getByRole("status", { name: "Applet status" });
  await expect
    .poll(
      async () => (await status.textContent())?.includes("Loading GeoGebra"),
      { timeout: 45_000 },
    )
    .toBe(false);
  expect(await status.textContent(), diagnostics.join("\n")).toContain(
    "GeoGebra ready (5.4.920.0)",
  );
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toBeVisible();
  const applet = page.getByLabel("GeoGebra Classic construction");
  const widthBefore = (await applet.boundingBox())?.width;
  if (!widthBefore) throw new Error("GeoGebra applet has no width.");
  const separator = page.getByRole("separator", {
    name: "Resize construction and editor panes",
  });
  await separator.focus();
  await separator.press("ArrowRight");
  await expect
    .poll(async () => (await applet.boundingBox())?.width)
    .toBeGreaterThan(widthBefore);
});
