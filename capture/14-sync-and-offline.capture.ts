import { expect, test } from '@playwright/test';
import { settle, shot } from './helpers';
import { asSetUpIpad, unlockIpad } from './native-shell';

const P = 'sync-and-offline';

test('sync and working offline', async ({ page }) => {
  await asSetUpIpad(page);
  await unlockIpad(page);
  await expect(page.getByTestId('page-title')).toBeVisible({ timeout: 90_000 });

  const cloud = page.getByTestId('sync-button').filter({ visible: true }).first();
  await cloud.click();
  await expect(page.getByTestId('sync-details')).toBeVisible();
  await shot(page, P, '01-sync-status');
  await page.keyboard.press('Escape');

  await page.getByTestId('nav-network').click();
  await expect(page.getByTestId('network-panel')).toBeVisible({ timeout: 30_000 });
  // The map lays itself out after its first paint; fit it once the devices are drawn.
  await expect(page.locator('[data-testid^="network-node-"]').first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('network-fit').click();
  await page.waitForTimeout(800);
  await settle(page);
  await shot(page, P, '02-network');

  await page.getByTestId('network-backups-open').click();
  await expect(page.getByTestId('backups-status')).toBeVisible({ timeout: 30_000 });
  await shot(page, P, '03-backups');
});

test('local network and the 30-day limit', async ({ page }) => {
  await asSetUpIpad(page, { localNetworkNotAsked: true, offlineTooLong: true });
  await unlockIpad(page);
  const notice = page.getByTestId('authorization-notice');
  await expect(notice).toBeVisible({ timeout: 60_000 });
  await shot(page, P, '04-read-only', { el: notice });
  const ask = page.getByTestId('local-network-explain');
  await expect(ask).toBeVisible({ timeout: 30_000 });
  await shot(page, P, '06-local-network', { el: ask });
  await page.goto('/help');
  await expect(page.getByTestId('guide-list')).toBeVisible();
  await shot(page, P, '05-help');
});
