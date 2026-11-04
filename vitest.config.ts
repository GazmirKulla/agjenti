import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Node unit tests do not compile the Next/Tailwind stylesheet pipeline.
  // Layout and CSS are verified in the browser and the production build.
  css: { postcss: { plugins: [] } },
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    setupFiles: ["src/test/semantic-fixtures.setup.ts"],
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
