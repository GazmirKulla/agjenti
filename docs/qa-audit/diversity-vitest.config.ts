import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: { include: ["docs/qa-audit/diversity-runtime.test.ts", "docs/qa-audit/orchestration-runtime.test.ts"] },
  resolve: { alias: { "@": path.resolve(process.cwd(), "src") } },
});
