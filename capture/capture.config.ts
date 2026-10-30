import { defineConfig, devices } from '@playwright/test';

/**
 * Screenshot runs, not tests. Each `<page>.capture.ts` walks one guide page's
 * steps in the real app and writes its images to docs/assets/<page>/.
 *
 * APP_URL      the running app (a production preview, so no developer overlays)
 * GUIDE_EMAIL  the demo account (made-up data only; this repo is public)
 * GUIDE_PASSWORD
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.capture\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    // WebKit is Safari's engine, which is what EasyJoey runs on the iPad. The
    // device keeps its touch and mobile flags, so steps behave like taps.
    ...devices['iPad Pro 11 landscape'],
    browserName: 'webkit',
    viewport: { width: 1180, height: 820 },
    deviceScaleFactor: 2,
    baseURL: process.env.APP_URL || 'http://localhost:4174',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-PH',
    timezoneId: 'Asia/Manila',
  },
});
