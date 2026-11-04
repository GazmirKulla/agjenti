import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
// Explicit opt-in: sends the prepared business content to the configured OpenAI model.
// RUN_JOURNEY_MODEL=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run --config e2e/customer-journey-model.config.mjs
const config = {
  root,
  test: { environment: 'node', include: ['e2e/customer-journey-model.test.ts'] },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
};

export default config;
