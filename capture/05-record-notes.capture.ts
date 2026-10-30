import { expect, test, type Page } from '@playwright/test';
import { settle, shot, signIn } from './helpers';
import { noToasts, patientWithEncounter } from './visits.lib';

const P = 'record-notes';

/** The sheet or dialog on top. */
const top = (page: Page) => page.getByRole('dialog').filter({ visible: true }).last();
const view = (page: Page, name: string) =>
  page
    .locator('[data-encounter-views]')
    .getByRole('radio', { name })
    .or(page.locator('[data-encounter-views]').getByRole('tab', { name }))
    .first();

/** Saves the open record form and waits for it to close. */
async function saveRecord(page: Page) {
  await top(page).getByTestId('record-editor-save').click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
}

test('record notes in the encounter', async ({ page }) => {
  test.setTimeout(480_000); // WebKit runs these long flows slower than the default 3 minutes
  await signIn(page);
  const visit = await patientWithEncounter(page, {
    firstName: 'Carmen',
    lastName: 'Bautista',
    sex: 'female',
    dateOfBirth: '1968-03-14',
    mobileNo: '0917 000 0031',
  });
  await page.goto(visit.url);
  const paper = page.getByTestId('encounter-paper');
  await expect(page.getByTestId('add-chief-complaint')).toBeVisible({ timeout: 60_000 });
  await noToasts(page);

  // 1. The encounter paper, empty.
  await shot(page, P, '01-encounter-paper');

  // 2. Chief complaint.
  await page.getByTestId('add-chief-complaint').click();
  await top(page).getByRole('textbox', { name: /Chief complaint/ }).fill('Cough and fever for three days');
  await shot(page, P, '02-chief-complaint', { el: top(page) });
  await saveRecord(page);

  // 3. Diagnosis, picked from the ICD-10 list.
  await page.getByTestId('add-diagnosis').click();
  await top(page).getByTestId('icd-search').fill('J06');
  const urti = top(page).getByTestId('icd-option').filter({ hasText: 'J06.9' }).first();
  await expect(urti).toBeVisible({ timeout: 30_000 });
  await noToasts(page);
  await shot(page, P, '03-diagnosis-search', { el: top(page) });
  await urti.click();
  await expect(top(page).getByTestId('icd-chip')).toBeVisible();
  await saveRecord(page);

  // 4. A note for the visit (saves by itself).
  await page.getByTestId('note-field').fill('Advised rest and plenty of fluids. Return if the fever lasts beyond five days.');
  await page.getByTestId('note-field').blur();
  await expect(page.getByTestId('note-status')).toHaveText('Saved', { timeout: 30_000 });
  await expect(paper.getByText('Cough and fever for three days').first()).toBeVisible();
  await shot(page, P, '04-summary-filled', { el: page.locator('[data-encounter-summary]') });

  // 5. Add record: the picker, then Vitals.
  await page.getByTestId('add-records').click();
  await expect(top(page).getByTestId('add-records-picker')).toBeVisible();
  await shot(page, P, '05-add-record');
  await top(page).getByTestId('add-records-search').fill('Vitals');
  await top(page).getByRole('button', { name: /Vitals/ }).first().click();
  const d = top(page);
  await d.getByLabel('Systolic BP').fill('120');
  await d.getByLabel('Diastolic BP').fill('80');
  await d.getByLabel('Pulse rate').fill('88');
  await d.getByLabel('Respiratory rate').fill('20');
  await d.getByLabel('Temperature', { exact: true }).fill('38.2');
  await d.getByLabel('Oxygen saturation').fill('98');
  await d.getByLabel('Oxygen saturation').blur();
  await d.getByLabel('Systolic BP').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await noToasts(page);
  await shot(page, P, '06-vitals', { el: top(page) });
  await saveRecord(page);

  // 6. The SOAP view with its record cards.
  await expect(page.getByRole('button', { name: 'Open Vitals' })).toBeVisible({ timeout: 30_000 });
  await noToasts(page);
  await page.locator('[data-encounter-views]').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await shot(page, P, '07-soap-view');

  // 7. Open a card: the reader, with Edit and the ⋯ menu.
  await page.getByRole('button', { name: 'Open Vitals' }).click();
  const reader = top(page);
  await expect(reader.getByRole('button', { name: 'Edit' })).toBeVisible();
  await shot(page, P, '08-record-card');
  await reader.getByRole('button', { name: /actions$/ }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Remove…' })).toBeVisible();
  await shot(page, P, '09-record-menu');

  // 8. Remove…: the reason step (kept, not removed).
  await page.getByRole('menuitem', { name: 'Remove…' }).click();
  const step = page.getByTestId('reason-step').filter({ visible: true });
  await expect(step).toBeVisible();
  await shot(page, P, '10-remove-record', { el: step });
  await step.getByTestId('reason-keep').click();
  await expect(step).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });

  // 9. End the encounter, then amend the vitals (finished records are amended, not edited).
  await page.getByTestId('encounter-step-end').click();
  const confirm = page.getByTestId('end-encounter-dialog');
  if (await confirm.isVisible({ timeout: 5_000 }).catch(() => false)) await confirm.getByTestId('end-confirm').click();
  await expect(page.getByTestId('encounter-status')).toHaveText('Ended', { timeout: 30_000 });
  await settle(page);
  await page.getByRole('button', { name: 'Open Vitals' }).click();
  await expect(top(page).getByRole('button', { name: 'Amend…' })).toBeVisible({ timeout: 15_000 });
  await noToasts(page);
  await shot(page, P, '11-amend-button');
  await top(page).getByRole('button', { name: 'Amend…' }).click();
  await expect(top(page).getByLabel('Temperature', { exact: true })).toBeVisible();
  await top(page).getByLabel('Temperature', { exact: true }).fill('37.8');
  await top(page).getByTestId('record-editor-save').click();
  const amend = page.getByTestId('reason-step').filter({ visible: true });
  await expect(amend).toBeVisible();
  await amend.getByText('Correction', { exact: true }).click();
  await shot(page, P, '12-amend-reason', { el: amend });
  await amend.getByTestId('reason-confirm').click();
  await expect(page.getByTestId('reason-step').filter({ visible: true })).toHaveCount(0, { timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('record-amended').first()).toBeVisible({ timeout: 30_000 });
  await noToasts(page);
  await page.locator('[data-encounter-views]').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await shot(page, P, '13-amended');

  // 10. On a finished record the ⋯ menu offers Mark entered in error… instead of Remove….
  await page.getByRole('button', { name: 'Open Vitals' }).click();
  await top(page).getByRole('button', { name: /actions$/ }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Mark entered in error…' })).toBeVisible();
  await shot(page, P, '14-entered-in-error-menu');
  await page.keyboard.press('Escape');
});
