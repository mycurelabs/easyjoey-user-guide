import { expect, test } from '@playwright/test';
import { appE2e } from './app-e2e';
import { EMAIL, PASSWORD, settle, shot } from './helpers';
import { asSetUpIpad } from './native-shell';

const P = 'sign-in-and-home';

test('the iPad lock screen', async ({ page }) => {
  await asSetUpIpad(page);
  await page.goto('/login');
  await expect(page.getByTestId('lock-screen')).toBeVisible({ timeout: 60_000 });
  await shot(page, P, '01-lock-screen');

  await page.getByTestId('member-m1').click();
  await expect(page.getByTestId('choose-someone-else')).toBeVisible();
  await page.fill('#password', PASSWORD || 'demo');
  await shot(page, P, '02-unlock');
});

test('web sign-in, forgot password, and Home', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('#email')).toBeVisible();
  await page.fill('#email', EMAIL);
  await shot(page, P, '03-welcome-back');

  await page.getByText('Forgot your password?').click();
  await expect(page.getByRole('button', { name: 'Send reset code' })).toBeVisible();
  // Cropped to the card: the page footer names the wrong company (an app bug, reported).
  await shot(page, P, '04-forgot-password', { el: page.locator('main') });

  // A real sign-in shows What's new once: picture it, then put it away.
  const { signIn: appSignIn } = await appE2e('patient-page.fixtures.ts');
  await appSignIn(page, EMAIL, PASSWORD);
  const reader = page.getByTestId('whats-new');
  if (await reader.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await shot(page, P, '08-whats-new');
    await page.getByTestId('whats-new-done').click();
    await expect(reader).toBeHidden();
  }

  await expect(page.getByTestId('delight-greeting')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('delight-chips')).toBeVisible({ timeout: 30_000 });
  await settle(page);
  await shot(page, P, '05-home');

  await shot(page, P, '06-notifications-and-transactions', { at: page.getByTestId('home-transactions-card') });

  await page.getByTestId('nav-user-trigger').click();
  await expect(page.getByTestId('nav-user-settings')).toBeVisible();
  await shot(page, P, '07-account-menu');
  await page.keyboard.press('Escape');
});
