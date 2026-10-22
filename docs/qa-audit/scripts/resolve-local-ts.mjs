// Node 24's built-in TypeScript transform; resolves only this repository's local imports.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) return nextResolve(pathToFileURL(path.join(root, 'src', specifier.slice(2)) + '.ts').href, context);
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !path.extname(specifier)) {
    const target = fileURLToPath(new URL(specifier, context.parentURL)) + '.ts';
    if (existsSync(target)) return nextResolve(pathToFileURL(target).href, context);
  }
  return nextResolve(specifier, context);
} });
