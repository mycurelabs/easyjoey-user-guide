import { defineConfig, devices } from '@playwright/test';

/**
 * Checks on the guide site itself (not the app). Run against `mkdocs serve`.
 *
 * SITE_URL  the guide's address, ending in a slash
 */
export default defineConfig({
  testDir: './site',
  testMatch: /.*\.spec\.ts$/,
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  outputDir: './test-results-site',
  use: {
    ...devices['iPad Pro 11 landscape'],
    browserName: 'webkit',
    baseURL: process.env.SITE_URL || 'http://127.0.0.1:8000/easyjoey-user-guide/',
  },
});
