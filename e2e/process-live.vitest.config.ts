import path from "node:path";
import { defineConfig } from "vitest/config";

// Explicit separate command: the ordinary unit suite never contacts a model.
export default defineConfig({
  css: { postcss: { plugins: [] } },
  test: { environment: "node", include: ["e2e/process-live-smoke.test.ts"], testTimeout: 90000, maxConcurrency: 1 },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../src") } },
});
