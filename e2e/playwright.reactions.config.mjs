import {defineConfig} from '@playwright/test';
import base from './playwright.config.mjs';
import {work} from './local.mjs';
import path from 'node:path';
export default defineConfig({...base,testMatch:'message-reactions.spec.mjs',timeout:240000,use:{...base.use,trace:'off'},reporter:[['list'],['json',{outputFile:path.join(work,'reactions-results.json')}]]});
