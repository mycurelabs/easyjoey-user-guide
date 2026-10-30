// Loaded by app-e2e.ts. The app's e2e helpers import '@playwright/test' from
// the app's own install; a test run may only load ONE copy of Playwright, so
// those imports are resolved from this folder instead.
const here = new URL('./app-e2e.ts', import.meta.url).href;
export async function resolve(specifier, context, next) {
  const dir = process.env.APP_E2E_DIR;
  if (dir && context.parentURL?.startsWith(new URL(`file://${dir.replace(/\/?$/, '/')}`).href)
      && /^(@playwright\/test|playwright)(\/|$)/.test(specifier)) {
    return next(specifier, { ...context, parentURL: here });
  }
  return next(specifier, context);
}
