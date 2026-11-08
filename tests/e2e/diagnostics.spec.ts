import { expect, test } from "@playwright/test";

test("keeps private editor content out of reports and network requests", async ({
  page,
}) => {
  const requests: { url: string; method: string; body: string }[] = [];
  page.on("request", (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData() ?? "",
    }),
  );
  await page.route("https://www.geogebra.org/apps/deployggb.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.GGBApplet = class {
      setHTML5Codebase() {}
      inject() { throw new Error('private construction a=42 from secret.ggb'); }
    };`,
    }),
  );
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("could not load");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).not.toContainText("secret.ggb");
  const secret = "Private Draft λ = 42";
  await page.getByRole("textbox", { name: "Authoring Source" }).fill(secret);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download diagnostic report" })
    .click();
  const file = await download;
  const stream = await file.createReadStream();
  let report = "";
  for await (const chunk of stream) report += chunk.toString();
  expect(JSON.parse(report)).toMatchObject({
    applicationVersion: "0.1.0",
    geogebraVersion: "5.4.920.0",
    events: [{ phase: "applet", code: "APPLET_LOAD_FAILED" }],
  });
  expect(report).not.toMatch(/Private Draft|secret\.ggb|a=42/);
  expect(requests.every((request) => request.method === "GET")).toBe(true);
  expect(JSON.stringify(requests)).not.toContain(secret);
});

test("does not report construction labels or transmit construction and editor content", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) =>
    requests.push(
      `${request.method()} ${request.url()} ${request.postData() ?? ""}`,
    ),
  );
  await page.route("https://www.geogebra.org/apps/deployggb.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.GGBApplet = class {
      constructor(params) { this.params = params; }
      setHTML5Codebase() {}
      inject() { this.params.appletOnLoad({
        getVersion: () => '5.4.920.0', setWidth() {}, setHeight() {},
        getAllObjectNames: () => ['PrivateConstruction42'],
        getObjectType: () => 'number', isDefined: () => true,
        getValueString: () => 'private value 42'
      }); }
    };`,
    }),
  );
  await page.goto("./");
  await expect(
    page.getByRole("status", { name: "Applet status" }),
  ).toContainText("ready");
  await page
    .getByRole("textbox", { name: "Authoring Source" })
    .fill("PrivateDraft99 @PrivateConstruction42@");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download diagnostic report" })
    .click();
  const stream = await (await download).createReadStream();
  let report = "";
  for await (const chunk of stream) report += chunk.toString();
  expect(report).not.toMatch(
    /PrivateConstruction42|PrivateDraft99|private value 42/,
  );
  expect(requests.every((request) => request.startsWith("GET "))).toBe(true);
  expect(requests.join("\n")).not.toMatch(
    /PrivateConstruction42|PrivateDraft99|private value 42/,
  );
});
