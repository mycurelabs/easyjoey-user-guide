import { register } from 'node:module';
import { createRequire } from 'node:module';

/**
 * The app's own e2e helpers (sign-in, fixtures), imported from the app's
 * e2e folder rather than copied here, so the guide follows the app when it
 * changes. APP_E2E_DIR points at that folder (apps/easyjoey/e2e in the app's
 * repository).
 */
const dir = process.env.APP_E2E_DIR;
if (!dir) throw new Error('Set APP_E2E_DIR to the EasyJoey app e2e folder (apps/easyjoey/e2e).');

// Make the app's helpers use this folder's Playwright (see resolve-hooks.mjs).
register('./resolve-hooks.mjs', import.meta.url);
const Module = createRequire(import.meta.url)('node:module');
const resolveFilename = Module._resolveFilename;
const captureParent = { id: import.meta.url, filename: new URL(import.meta.url).pathname, paths: Module._nodeModulePaths(new URL('.', import.meta.url).pathname) };
Module._resolveFilename = function (request: string, parent: any, ...rest: unknown[]) {
  if (parent?.filename?.startsWith(dir) && /^(@playwright\/test|playwright)(\/|$)/.test(request)) parent = captureParent;
  return resolveFilename.call(this, request, parent, ...rest);
};

export const appE2e = <T = any>(file: string): Promise<T> => import(`${dir.replace(/\/$/, '')}/${file}`);
