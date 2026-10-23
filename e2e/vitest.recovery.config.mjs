import path from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['e2e/recovery-fixtures.test.ts'], fileParallelism: false, testTimeout: 90000 },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '../src') } },
});
