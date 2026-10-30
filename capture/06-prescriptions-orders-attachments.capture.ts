import { expect, test, type Page } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appE2e } from './app-e2e';
import { settle, shot, signIn } from './helpers';
import { noToasts, patientWithEncounter, syntheticImage } from './visits.lib';

const P = 'prescriptions-orders-attachments';

const top = (page: Page) => page.getByRole('dialog').filter({ visible: true }).last();
const views = (page: Page) => page.locator('[data-encounter-views]');
async function openView(page: Page, name: string) {
  const v = views(page);
  await v.getByRole('radio', { name }).or(v.getByRole('tab', { name })).first().click();
}
async function saveRecord(page: Page) {
  await top(page).getByTestId('record-editor-save').click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
}

test('prescriptions, orders and attachments', async ({ page }) => {
  test.setTimeout(900_000); // WebKit, and a busy shared backend, make this long flow slow
  await signIn(page);
  const visit = await patientWithEncounter(page, {
    firstName: 'Rogelio',
    lastName: 'Santos',
    sex: 'male',
    dateOfBirth: '1955-07-21',
    mobileNo: '0917 000 0032',
  });
  // The prescription prints the doctor's licence number: show a placeholder for the run,
  // then put the account's own back (the app's e2e helper, encounter-paper.fixtures.ts).
  const { setOwnLicences } = await appE2e('encounter-paper.fixtures.ts');
  const licences = await setOwnLicences(page, { doc_PRCLicenseNo: '0000000' });
  try {
    await page.goto(visit.url);
    await expect(page.getByTestId('add-chief-complaint')).toBeVisible({
      timeout: 60_000,
    });
    await noToasts(page);

    // A diagnosis first, so the prescription and the order can carry it.
    await page.getByTestId('add-diagnosis').click();
    await top(page).getByTestId('icd-search').fill('J20.9');
    await top(page).getByTestId('icd-option').filter({ hasText: 'J20.9' }).first().click();
    await saveRecord(page);

    // 1. Prescription: the empty view.
    await openView(page, 'Prescription');
    await expect(page.getByText('No medicines prescribed for this visit.')).toBeVisible({ timeout: 30_000 });
    await noToasts(page);
    await views(page).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await shot(page, P, '01-prescription-view');

    // 2. Add prescription: search a medicine.
    await page.getByRole('button', { name: 'Add prescription' }).last().click();
    await top(page).getByTestId('rx-search').fill('amox');
    const med = top(page).getByTestId('rx-result').filter({ hasText: 'Amoxicillin 500 mg capsule' }).first();
    await expect(med).toBeVisible({ timeout: 30_000 });
    await shot(page, P, '02-rx-search', { el: top(page) });
    await med.click();

    // 3. The Medicine page: directions and quantity.
    const d = top(page);
    await expect(d.getByLabel('Take', { exact: true })).toBeVisible();
    await d.getByLabel('Take', { exact: true }).fill('1');
    await d.getByLabel('Take unit').selectOption('capsule');
    const often = d.getByLabel('Frequency', { exact: true });
    await often.fill('3x a');
    const tid = page.getByRole('option', { name: '3x a day', exact: true });
    await expect(tid).toBeVisible({ timeout: 10_000 });
    await tid.click();
    await d.getByLabel('For how long', { exact: true }).fill('7');
    await d.getByLabel('Quantity', { exact: true }).fill('21');
    await d.getByLabel('Quantity', { exact: true }).blur();
    // Focus left in a field makes WebKit scroll back to it, so nothing is focused for the shot.
    await d.getByRole('heading', { name: 'Directions', level: 3 }).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await shot(page, P, '03-rx-medicine', { el: top(page) });

    // 4. Back to the prescription, then Save.
    await top(page).getByTestId('record-editor-cancel').click(); // the "Prescription" back button
    await expect(top(page).getByTestId('rx-line')).toBeVisible();
    await top(page)
      .getByTestId('rx-line')
      .evaluate(el => el.scrollIntoView({ block: 'start' }));
    await shot(page, P, '04-rx-ready', { el: top(page) });
    await saveRecord(page);

    // 5. The saved prescription.
    await expect(page.getByText('Amoxicillin 500 mg capsule').first()).toBeVisible({ timeout: 30_000 });
    await noToasts(page);
    await page.locator('[data-encounter-prescriptions]').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await shot(page, P, '05-rx-saved');

    // 6. Share records: print or save the visit's papers.
    await page.getByTestId('encounter-share').click();
    await expect(top(page)).toBeVisible();
    await settle(page);
    await shot(page, P, '06-share-records', { el: top(page) });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });

    // 7. Orders: Add order, then Lab test order.
    await openView(page, 'Orders');
    await expect(page.getByText('No orders for this visit.')).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Add order' }).last().click();
    await expect(top(page).getByTestId('add-records-picker')).toBeVisible();
    await shot(page, P, '07-add-order', { el: top(page) });
    await top(page)
      .getByRole('button', { name: /Lab test order/ })
      .first()
      .click();

    // 8. The test, the diagnosis and the reason.
    await top(page).getByTestId('order-search').fill('Complete blood count');
    await top(page).getByTestId('order-use-typed').click();
    await top(page).getByTestId('icd-option').filter({ hasText: 'J20.9' }).first().click();
    await top(page).getByTestId('order-reason').fill('Check for bacterial infection');
    await top(page)
      .getByTestId('order-kind')
      .evaluate(el => el.scrollIntoView({ block: 'start' }));
    await shot(page, P, '08-lab-order', { el: top(page) });
    await saveRecord(page);

    // 9. The order sheet, and a line's ⋯ menu.
    const sheet = page.locator('[data-encounter-orders]');
    await expect(sheet.getByTestId('order-name').first()).toBeVisible({
      timeout: 30_000,
    });
    await noToasts(page);
    await views(page).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await shot(page, P, '09-order-sheet');
    await sheet
      .getByRole('button', { name: /actions$/ })
      .first()
      .click();
    await expect(page.getByRole('menuitem', { name: 'Discontinue…' })).toBeVisible();
    await shot(page, P, '10-order-menu');
    await page.keyboard.press('Escape');

    // 10. Attachments: a signed consent linked to this visit shows here. Recorded
    //     through the patient profile (a made-up image, never a real form).
    const file = join(tmpdir(), 'ej-procedure-consent.jpg');
    await syntheticImage(file, 'Signed procedure consent');
    await page.goto(`${visit.url}?consents=1`);
    const policies = page.getByTestId('patient-policies');
    await expect(policies).toBeVisible({ timeout: 60_000 });
    await policies.getByTestId('consent-record').click();
    const cs = page.getByTestId('consent-capture-sheet');
    await expect(cs).toBeVisible();
    await cs.getByText('Procedure consent', { exact: true }).click();
    await cs.getByTestId('consent-procedure').fill('Nebulization');
    await cs.getByLabel('Encounter').selectOption({ index: 1 });
    await cs.getByTestId('consent-photo-input').setInputFiles(file);
    await cs.getByTestId('consent-document').fill('PC-2026');
    await cs.getByTestId('consent-version').fill('1');
    await cs.getByTestId('consent-save').click();
    await expect(cs).toBeHidden({ timeout: 30_000 });
    await page.goto(visit.url);
    await expect(page.getByTestId('encounter-paper')).toBeVisible({
      timeout: 60_000,
    });
    await openView(page, 'Attachments');
    await expect(page.locator('[data-encounter-attachments] figure').first()).toBeVisible({ timeout: 30_000 });
    await noToasts(page);
    await views(page).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await shot(page, P, '11-attachments');
  } finally {
    await setOwnLicences(page, licences);
  }
});
