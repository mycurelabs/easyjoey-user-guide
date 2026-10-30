import { test, expect, type Page } from '@playwright/test';

// The reader's device asks for dark, so a light page proves light is our default, not the device's.
test.use({ colorScheme: 'dark' });

const scheme = (page: Page) => page.locator('body').getAttribute('data-md-color-scheme');
const themeSwitch = (page: Page) => page.locator('.md-header form[data-md-component="palette"] label:visible');

test('opens in light mode, even when the device prefers dark', async ({ page }) => {
  await page.goto('./');
  expect(await scheme(page)).toBe('default');
});

test('the switch in the top bar changes between light and dark', async ({ page }) => {
  await page.goto('./');
  await expect(themeSwitch(page)).toHaveCount(1);

  await themeSwitch(page).click();
  expect(await scheme(page)).toBe('slate');

  await themeSwitch(page).click();
  expect(await scheme(page)).toBe('default');
});

test('the chosen mode stays after a refresh and on other pages', async ({ page }) => {
  await page.goto('./');
  await themeSwitch(page).click();
  expect(await scheme(page)).toBe('slate');

  await page.reload();
  expect(await scheme(page)).toBe('slate');

  await page.goto('visits/chart-teeth/');
  expect(await scheme(page)).toBe('slate');
});

test('clearing the site data brings back light mode', async ({ page }) => {
  await page.goto('./');
  await themeSwitch(page).click();
  expect(await scheme(page)).toBe('slate');

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  expect(await scheme(page)).toBe('default');
});
