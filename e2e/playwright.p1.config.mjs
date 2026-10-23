import {defineConfig} from '@playwright/test';
import base from './playwright.config.mjs';
export default defineConfig({...base,testMatch:'composite-recall.spec.mjs',
  outputDir:'.e2e-local/p1/browser',reporter:[['list'],['json',{outputFile:'.e2e-local/p1/browser-results.json'}]],
  use:{...base.use,trace:'off',screenshot:'off'}});
