import { expect, test } from '@playwright/test';
import { shot } from './helpers';
import { asNewIpad } from './native';

const P = 'set-up-your-ipad';

test('set up this device', async ({ page }) => {
  await asNewIpad(page);
  await page.goto('/setup');
  await expect(page.getByLabel('Email')).toBeVisible({ timeout: 30_000 });
  await shot(page, P, '01-set-up-this-device');

  await page.getByLabel('Email').fill('dr.ana@dl.test');
  await page.getByLabel('Password').fill('Joey-Demo-2026!');
  await shot(page, P, '02-sign-in-filled');
});

test('sign in on the web', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('#email')).toBeVisible({ timeout: 30_000 });
  await shot(page, P, '03-sign-in');
});
