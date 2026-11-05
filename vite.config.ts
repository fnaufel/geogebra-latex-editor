import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/geogebra-latex-editor/",
  test: { environment: "jsdom", include: ["tests/unit/**/*.test.ts"] },
});
