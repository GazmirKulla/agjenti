import {defineConfig} from '@playwright/test';
import base from './playwright.config.mjs';
export default defineConfig({...base,testMatch:'message-transport.spec.mjs',timeout:120000,use:{...base.use,trace:'off'}});
