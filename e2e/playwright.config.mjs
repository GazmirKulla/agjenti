import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { work } from './local.mjs';

export default defineConfig({
  testDir: '.', testMatch: '*.spec.mjs', workers: 1, fullyParallel: false,
  retries: 0, timeout: 60000, expect: { timeout: 15000 },
  outputDir: path.join(work, 'results'),
  reporter: [['list'], ['json', { outputFile: path.join(work, 'results.json') }]],
  use: { baseURL: 'http://localhost:3103', browserName: 'chromium',
    screenshot: 'only-on-failure', trace: 'retain-on-failure', serviceWorkers: 'block' },
});
