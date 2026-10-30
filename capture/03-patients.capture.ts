import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { appE2e } from './app-e2e';
import { shot, signIn } from './helpers';

const FIND = 'find-or-add-a-patient';
const START = 'start-an-encounter';

const search = (page: Page) => page.getByPlaceholder('Name or patient number').filter({ visible: true });

async function choose(page: Page, dialog: Locator, label: string, option: string) {
  await dialog.getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).first().click();
}

test('find or add a patient, then start an encounter', async ({ page }) => {
  await signIn(page);
  await page.goto('/patients');
  await expect(search(page)).toBeVisible();
  // Encounter counts fill in after the folders; wait for them so no folder reads "0 encounters" by mistake.
  const counted = page.getByText(/^[1-9]\d* encounters?$/).first();
  await expect(counted).toBeVisible({ timeout: 30_000 });
  await shot(page, FIND, '01-patients');

  await search(page).fill('Reyes');
  // Wait for the results to replace the full list, then for their counts.
  await expect(page.getByText('Aguilar', { exact: true }).nth(1)).toBeHidden({ timeout: 30_000 });
  await expect(counted).toBeVisible({ timeout: 30_000 });
  await shot(page, FIND, '02-search');
  await search(page).fill('');

  await page.getByRole('button', { name: 'Add patient' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add patient' });
  await expect(dialog.getByLabel('First name')).toBeVisible();
  await shot(page, FIND, '03-add-patient-empty');

  await dialog.getByLabel('First name').fill('Lea');
  await dialog.getByLabel('Last name').fill('Ramos');
  await choose(page, dialog, 'Sex', 'Female');
  await dialog.getByLabel('Date of birth', { exact: true }).fill('1990-04-12');
  await shot(page, FIND, '04-add-patient-filled');

  // The dialog shows one section at a time; Mobile number lives under Contact.
  await dialog.getByRole('button', { name: /^Contact/ }).first().click();
  await dialog.locator('#new-phone').fill('0917 000 0021');
  await shot(page, FIND, '05-add-patient-contact');

  await dialog.getByRole('button', { name: 'Add patient' }).click();
  await expect(page).toHaveURL(/\/patients\/[^/?]+/, { timeout: 30_000 });
  await expect(page.getByTestId('no-encounters')).toBeVisible({ timeout: 30_000 });
  await shot(page, START, '01-no-encounters');

  await page.getByTestId('patient-switcher').click();
  await expect(page.getByTestId('menu-start-encounter')).toBeVisible();
  await shot(page, START, '02-patient-menu');
  await page.keyboard.press('Escape');

  await page.getByTestId('no-encounters').getByRole('button', { name: 'Start encounter' }).click();
  await expect(page.getByText(/Encounter started for/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Checking allergies…')).toBeHidden({ timeout: 30_000 });
  await shot(page, START, '03-encounter-started');
  // Remember where the new visit lives for the next captures.
  writeFileSync(new URL('./.visit-url', import.meta.url), page.url());

  // Every run adds a new Lea Ramos. Close this visit and archive this copy, so the
  // clinic keeps a single Lea Ramos (the one other pages picture) between runs.
  const { patch } = await appE2e('patient-page.fixtures.ts');
  const [, patientId, encounterId] = page.url().match(/\/patients\/([^/?]+)\/encounters\/([^/?]+)/) ?? [];
  if (encounterId) await patch(page, `medical-encounters/${encounterId}`, { finish: true }).catch(() => {});
  if (patientId) await patch(page, `medical-patients/${patientId}`, { archive: true }).catch(() => {});
});
