import path from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: { environment: 'node', include: ['docs/qa-audit/tests/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
});
