import { expect, test } from '@playwright/test';
import { settle, shot, signIn } from './helpers';

const P = 'notifications-and-analytics';

// Looks only: nothing is marked read (Mark all as read is shown, never pressed).
test('notifications and analytics', async ({ page }) => {
  await signIn(page);

  // The bell's panel, from any page.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('page-title')).toBeVisible({ timeout: 90_000 });
  await page.getByTestId('notifications-bell').filter({ visible: true }).first().click();
  await expect(page.getByTestId('notifications-popover')).toBeVisible();
  await settle(page);
  await shot(page, P, '01-bell');
  await page.keyboard.press('Escape');

  // The Notifications page.
  await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('notifications-page')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('notifications-total').or(page.getByTestId('notifications-empty'))).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await shot(page, P, '02-notifications');

  // Analytics: Overview, then a tap on each tab, on the 30-day range.
  await page.goto('/analytics', { waitUntil: 'domcontentloaded' });
  const tabs = page.getByRole('tablist').first();
  await expect(tabs).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Last 30 days' }).or(page.getByRole('radio', { name: 'Last 30 days' })).or(page.getByRole('tab', { name: 'Last 30 days' })).first().click();
  for (const [tab, name] of [
    ['Overview', '03-analytics-overview'],
    ['Revenue', '04-analytics-revenue'],
    ['Patients', '05-analytics-patients'],
    ['Clinical', '06-analytics-clinical'],
  ] as const) {
    const t = page.getByRole('tab', { name: tab, exact: true }).first();
    await t.click();
    await expect(t).toHaveAttribute('aria-selected', 'true');
    await settle(page);
    await page.waitForTimeout(1200);
    await shot(page, P, name);
  }
});
