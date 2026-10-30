import { expect, test } from '@playwright/test';
import { shot, signIn } from './helpers';
import { openSettingsAt } from './visits.lib';

const P = 'settings-basics';

// Looks only: nothing here changes a setting (other pages are captured on the same account).
test('settings basics', async ({ page }) => {
  await signIn(page);
  await page.goto('/');
  await expect(page.getByTestId('page-title')).toBeVisible({ timeout: 90_000 });

  // The app's own opener (batch40.fixtures.ts): account menu › Settings › Profile.
  await openSettingsAt(page, 'profile');
  const dialog = page.getByTestId('settings-dialog').filter({ visible: true }).first();
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await shot(page, P, '01-settings');

  const open = async (key: string, name: string, scrollTo?: string) => {
    const item = page.getByTestId(`settings-nav-${key}`).filter({ visible: true }).first();
    await item.click();
    await expect(item).toHaveAttribute('aria-current', 'page');
    const pane = page.getByTestId('settings-pane').filter({ visible: true }).first();
    await expect(pane).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(600);
    if (scrollTo)
      await pane
        .getByText(scrollTo, { exact: true })
        .first()
        .evaluate(el => el.scrollIntoView({ block: 'start' }));
    await shot(page, P, name);
  };

  await open('clinic', '03-clinic');
  await open('clinic', '03b-clinic-hours', 'Operating hours');
  await open('users', '04-users');
  await open('general', '05-general');
  await open('appearance', '06-appearance');
  await open('appointments', '07-appointments');
  await open('encounter', '08-encounter');
  await open('services', '09-services');
  await open('billing', '10-billing');
  await open('notifications', '11-notifications');
  await open('records', '12-records');
});
