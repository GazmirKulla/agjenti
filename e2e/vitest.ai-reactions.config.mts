import path from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@': path.resolve('src') } },
  test: { environment: 'node', include: ['e2e/ai-reactions.test.mts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 90000 },
});
