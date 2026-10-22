import path from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['e2e/migo-persistence.test.ts'], fileParallelism: false, testTimeout: 20000, hookTimeout: 90000 },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '../src') } },
});
