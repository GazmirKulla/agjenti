import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Explicit opt-in integration gate; never load the repository's .env.local.
export default defineConfig({
  test: {
    environment: 'node', include: ['e2e/google-recovery.test.ts'],
    fileParallelism: false, testTimeout: 15000, hookTimeout: 90000,
  },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '../src') } },
});
