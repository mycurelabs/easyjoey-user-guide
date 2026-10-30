import { expect, test, type Page } from '@playwright/test';
import { shot } from './helpers';
import { asNewIpad } from './native';

/**
 * The setup screens after "Sign in and set up": the restore choice, the
 * download checklist, "Sign in to finish", "not activated yet" and a setup
 * error. The account, clinic and backups are made up (see native.ts).
 */
const P = 'set-up-your-ipad';

async function signInAndSetUp(page: Page) {
  await page.goto('/setup');
  await page.getByLabel('Email', { exact: true }).fill('dr.ana@dl.test');
  await page.getByLabel('Password', { exact: true }).fill('Joey-Demo-2026!');
  await page.getByRole('button', { name: 'Sign in and set up', exact: true }).click();
}

test('restore choice, then the download checklist', async ({ page }) => {
  await asNewIpad(page, { cloud: true, backups: true });
  await signInAndSetUp(page);
  await expect(page.getByTestId('setup-restore')).toBeVisible({ timeout: 30_000 });
  await shot(page, P, '04-restore-from-a-backup');

  await page.getByTestId('restore-skip').click();
  await expect(page.getByTestId('setup-downloading')).toBeVisible({ timeout: 30_000 });
  await shot(page, P, '05-getting-your-clinic-ready');
});

test('sign in to finish', async ({ page }) => {
  await asNewIpad(page, { resume: 'finish' });
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'Sign in to finish' })).toBeVisible({ timeout: 30_000 });
  await shot(page, P, '06-sign-in-to-finish');
});

test('not activated yet', async ({ page }) => {
  await asNewIpad(page, { cloud: true, notActivated: true });
  await signInAndSetUp(page);
  await expect(page.getByTestId('setup-not-activated')).toBeVisible({ timeout: 30_000 });
  await shot(page, P, '07-not-activated');
});

test('a setup error', async ({ page }) => {
  await asNewIpad(page, { cloud: true, wrongPassword: true });
  await signInAndSetUp(page);
  await expect(page.getByTestId('setup-guidance')).toBeVisible({ timeout: 30_000 });
  await shot(page, P, '08-setup-error');
});
