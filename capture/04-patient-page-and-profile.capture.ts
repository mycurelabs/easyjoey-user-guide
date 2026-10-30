import { expect, test, type Page } from '@playwright/test';
import { settle, shot, signIn } from './helpers';
// Made-up patients through the app's own e2e API helpers (see visits.lib.ts).
import { findOrCreatePatient, type Person } from './visits.lib';

const P = 'patient-page-and-profile';

/** Opens the guide's patient on their Encounters tab (a bare patient link would open their latest encounter). */
async function openPatient(page: Page, who: Person) {
  const { patientId } = await findOrCreatePatient(page, who);
  await page.goto(`/patients/${patientId}?tab=encounters`);
  await expect(page.getByTestId('patient-switcher')).toBeVisible({ timeout: 30_000 });
  return `/patients/${patientId}`;
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).filter({ visible: true }).first();

test('the patient page and profile', async ({ page }) => {
  await signIn(page);

  // Bea is a minor: her profile is pictured too.
  const beaUrl = await openPatient(page, { firstName: 'Bea', lastName: 'Garcia', sex: 'female', dateOfBirth: '2015-06-03', mobileNo: '09170000033' });
  const tomasUrl = await openPatient(page, { firstName: 'Tomas', lastName: 'Ignacio', sex: 'male', dateOfBirth: '1979-02-14', mobileNo: '09170000031' });

  // Lea already has a visit, so her page has something on every tab.
  await openPatient(page, { firstName: 'Lea', lastName: 'Ramos', sex: 'female', dateOfBirth: '1990-04-12', mobileNo: '09170000021' });
  await tab(page, 'Encounters').click();
  await settle(page);
  await shot(page, P, '01-encounters');

  await tab(page, 'Patient summary').click();
  await settle(page);
  await shot(page, P, '02-summary');

  await tab(page, 'Billing').click();
  await settle(page);
  await shot(page, P, '03-billing');

  await page.getByTestId('patient-switcher').click();
  await expect(page.getByTestId('patient-menu')).toBeVisible();
  await shot(page, P, '04-patient-menu');
  await page.keyboard.press('Escape');

  await page.getByTestId('patient-switcher').click();
  await page.getByTestId('switch-patient').click();
  const switcher = page.getByRole('dialog', { name: 'Switch patient' });
  await expect(switcher).toBeVisible();
  await shot(page, P, '05-switch-patient');
  await page.keyboard.press('Escape');
  await expect(switcher).toBeHidden();

  await page.getByTestId('patient-share').click();
  await expect(page.getByText('Share medical records')).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, P, '06-share-records');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  await page.getByTestId('patient-switcher').click();
  await page.getByTestId('menu-view-profile').click();
  const profile = page.getByRole('dialog').filter({ hasText: 'Overview' }).first();
  await expect(profile).toBeVisible({ timeout: 30_000 });
  await settle(page);
  await shot(page, P, '07-profile');
  await page.keyboard.press('Escape');
  await expect(profile).toBeHidden();

  // Tomas: Edit details and the archive question (cancelled, nothing changes).
  await page.goto(tomasUrl);
  await expect(page.getByTestId('patient-switcher')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('patient-switcher').click();
  await page.getByTestId('menu-edit').click();
  const edit = page.getByRole('dialog').filter({ hasText: 'Save' }).first();
  await expect(edit).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await settle(page);
  await shot(page, P, '08-edit-details');
  await edit.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(edit).toBeHidden();

  await page.getByTestId('patient-switcher').click();
  await page.getByTestId('menu-archive').click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).last();
  await expect(confirm).toBeVisible();
  await shot(page, P, '09-archive-confirm');
  await confirm.getByRole('button', { name: 'Cancel' }).click();

  await page.goto(beaUrl);
  await expect(page.getByTestId('patient-switcher')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('patient-switcher').click();
  await page.getByTestId('menu-view-profile').click();
  const beaProfile = page.getByRole('dialog').filter({ hasText: 'Overview' }).first();
  await expect(beaProfile).toBeVisible({ timeout: 30_000 });
  await beaProfile.getByRole('button', { name: 'Family & Emergency' }).first().click();
  await settle(page);
  await shot(page, P, '10-profile-family');
});
