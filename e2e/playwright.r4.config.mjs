import {defineConfig} from '@playwright/test';
import base from './playwright.config.mjs';
// No raw browser traces/screenshots/session tokens in the R4 evidence artifact.
export default defineConfig({...base,testMatch:'r4-boundary.spec.mjs',
  outputDir:'.e2e-local/r4/browser',reporter:[['list'],['json',{outputFile:'.e2e-local/r4/browser-results.json'}]],
  use:{...base.use,trace:'off',screenshot:'off'}});
