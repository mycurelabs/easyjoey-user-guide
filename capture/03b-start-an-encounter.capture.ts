import { expect, test } from '@playwright/test';
import { shot, signIn } from './helpers';

const P = 'start-an-encounter';

// Images 01–03 come from 03-patients (a brand-new patient's first encounter).
// This run only looks: it opens Add encounter, picks a patient, then cancels.
test('start an encounter from the Encounters page', async ({ page }) => {
  await signIn(page);
  await page.goto('/encounters');
  await expect(page.getByRole('button', { name: 'Add encounter' }).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, P, '04-encounters-page');

  await page.getByRole('button', { name: 'Add encounter' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add encounter' });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Search patients…').fill('Camille');
  const pick = dialog.getByTestId('start-encounter-patient').filter({ hasText: 'Aguilar, Camille' }).first();
  await expect(pick).toBeVisible({ timeout: 20_000 });
  await pick.click();
  // Picking a patient can scroll the window; bring its title back into view.
  await dialog.getByRole('heading', { name: 'Add encounter' }).scrollIntoViewIfNeeded();
  await shot(page, P, '05-add-encounter-dialog');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});
