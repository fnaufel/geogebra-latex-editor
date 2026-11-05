import { expect, test } from "@playwright/test";

const fakeApplet = (
  version: string,
  retryVersion = version,
  failFirst = false,
) => `
  window.GGBApplet = class {
    constructor(params) { this.params = params; }
    setHTML5Codebase() {}
    inject(element) {
      window.__injections = (window.__injections || 0) + 1;
      if (${failFirst} && window.__injections === 1) throw new Error('Applet rejected initialization');
      element.textContent = 'GeoGebra construction toolbar · Undo · Redo';
      setTimeout(() => this.params.appletOnLoad({
        getVersion: () => window.__injections === 1 ? '${version}' : '${retryVersion}',
        setWidth() {},
        setHeight() {},
        remove() {},
      }), 200);
    }
  };
`;

test("shows the two-pane shell only after the applet callback and resizes by keyboard", async ({
  page,
}) => {
  await page.route("https://www.geogebra.org/apps/deployggb.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: fakeApplet("5.4.920.0"),
    }),
  );
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("Loading GeoGebra");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready");
  await expect(
    page.getByRole("heading", { name: "Construction" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Authoring Source" }),
  ).toBeVisible();
  await expect(page.getByText("No Editing Target")).toBeVisible();
  const separator = page.getByRole("separator", {
    name: "Resize construction and editor panes",
  });
  const before = Number(await separator.getAttribute("aria-valuenow"));
  await separator.focus();
  await separator.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", String(before + 2));
  const bounds = await separator.boundingBox();
  if (!bounds) throw new Error("Splitter is not visible.");
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(bounds.x + 80, bounds.y + bounds.height / 2);
  await page.mouse.up();
  expect(Number(await separator.getAttribute("aria-valuenow"))).toBeGreaterThan(
    before + 2,
  );
  await expect(
    page.getByText("Unofficial · Made with GeoGebra®"),
  ).toBeVisible();
});

test("stacks the panes on a narrow viewport without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await page.route("https://www.geogebra.org/apps/deployggb.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: fakeApplet("5.4.920.0"),
    }),
  );
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready");
  const separator = page.getByRole("separator", {
    name: "Resize construction and editor panes",
  });
  await expect(separator).toHaveAttribute("aria-orientation", "horizontal");
  await separator.focus();
  await separator.press("ArrowDown");
  await expect(separator).toHaveAttribute("aria-valuenow", "54");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("shows a version mismatch and recovers through Retry", async ({
  page,
}) => {
  await page.route("https://www.geogebra.org/apps/deployggb.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: fakeApplet("5.4.919.0", "5.4.920.0"),
    }),
  );
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("Version mismatch");
  await page.getByRole("button", { name: "Retry GeoGebra" }).click();
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready");
});

test("shows a retryable bundle failure", async ({ page }) => {
  let loads = 0;
  await page.route("https://www.geogebra.org/apps/deployggb.js", (route) => {
    loads += 1;
    return loads === 1
      ? route.abort()
      : route.fulfill({
          contentType: "text/javascript",
          body: fakeApplet("5.4.920.0"),
        });
  });
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra bundle could not be loaded");
  await page.getByRole("button", { name: "Retry GeoGebra" }).click();
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready");
});

test("shows a retryable applet initialization failure and keeps the editor available", async ({
  page,
}) => {
  await page.route("https://www.geogebra.org/apps/deployggb.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: fakeApplet("5.4.920.0", "5.4.920.0", true),
    }),
  );
  await page.goto("./");
  const editor = page.getByRole("textbox", { name: "Authoring Source" });
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("Applet rejected initialization");
  await page.getByRole("button", { name: "Retry GeoGebra" }).click();
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("GeoGebra ready");
  await expect(editor).toBeVisible();
  await expect(page.getByText("No text is open for editing.")).toBeVisible();
});
