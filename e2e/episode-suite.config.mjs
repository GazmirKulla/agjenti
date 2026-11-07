import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
// Opt-in real model. Never part of `yarn test`.
// RUN_EPISODE_SUITE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run --config e2e/episode-suite.config.mjs
export default {
  root,
  css: { postcss: { plugins: [] } },
  test: { environment: "node", include: ["e2e/episode-suite.test.ts"], testTimeout: 90000, maxConcurrency: 2 },
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
};
