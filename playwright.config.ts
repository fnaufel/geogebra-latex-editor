import { defineConfig, devices } from "@playwright/test";

const deployedBaseURL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  // Real GeoGebra applets are memory intensive; run release journeys in order.
  workers: 1,
  use: {
    baseURL: deployedBaseURL ?? "http://127.0.0.1:5173/geogebra-latex-editor/",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: deployedBaseURL
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1",
        url: "http://127.0.0.1:5173/geogebra-latex-editor/",
        reuseExistingServer: !process.env.CI,
      },
});
