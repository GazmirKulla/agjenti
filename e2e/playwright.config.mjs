import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '.', testMatch: '*.spec.mjs', workers: 1, fullyParallel: false,
  retries: 0, timeout: 60000, expect: { timeout: 15000 },
  outputDir: '../.e2e-local/results',
  reporter: [['list'], ['json', { outputFile: fileURLToPath(new URL('../.e2e-local/results.json', import.meta.url)) }]],
  use: { baseURL: 'http://localhost:3103', browserName: 'chromium',
    screenshot: 'only-on-failure', trace: 'retain-on-failure', serviceWorkers: 'block' },
});
