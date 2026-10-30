import { expect, test } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { settle, shot, signIn } from './helpers';
import { findOrCreatePatient, noToasts, syntheticImage } from './visits.lib';

const P = 'consents';

test('consents', async ({ page }) => {
  test.setTimeout(480_000); // WebKit runs these long flows slower than the default 3 minutes
  await signIn(page);
  // A new made-up patient each run (earlier copies archived), so the page starts with nothing on file.
  const { patientId } = await findOrCreatePatient(
    page,
    { firstName: 'Paolo', lastName: 'Mendoza', sex: 'male', dateOfBirth: '2001-11-05', mobileNo: '0917 000 0033' },
    { fresh: true },
  );

  // 1. The patient menu: View profile.
  await page.goto(`/patients/${patientId}`);
  await page.getByTestId('patient-switcher').click();
  await expect(page.getByRole('menuitem', { name: 'View profile' })).toBeVisible({ timeout: 30_000 });
  await shot(page, P, '01-view-profile');
  await page.getByRole('menuitem', { name: 'View profile' }).click();

  // 2. Patient profile › Policies and consents.
  const dialog = page.getByRole('dialog').filter({ visible: true }).first();
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Policies and consents' }).or(dialog.getByRole('link', { name: 'Policies and consents' })).or(dialog.getByRole('tab', { name: 'Policies and consents' })).first().click();
  const policies = page.getByTestId('patient-policies');
  await expect(policies.getByTestId('consent-record')).toBeVisible({ timeout: 30_000 });
  await policies.getByTestId('consent-record').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await settle(page);
  await shot(page, P, '02-policies-and-consents');

  // 3. Record consent: what was signed, and how.
  await policies.getByTestId('consent-record').click();
  const sheet = page.getByTestId('consent-capture-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByText('General treatment consent', { exact: true }).click();
  await shot(page, P, '03-record-consent', { el: sheet });

  // 4. Sign on screen isn't available until the clinic has approved wording (shown, not used).
  await sheet.getByText('Sign on screen', { exact: true }).click();
  await expect(sheet.getByText('Use signed paper')).toBeVisible();
  await sheet.getByText('Use signed paper').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await shot(page, P, '04-sign-on-screen', { el: sheet });
  await sheet.getByText('Use signed paper').click();

  // 5. Signed paper: a photo of the signed form (a made-up image) and the document code.
  const file = join(tmpdir(), 'ej-signed-consent.jpg');
  await syntheticImage(file, 'Signed consent form');
  await sheet.getByTestId('consent-photo-input').setInputFiles(file);
  await sheet.getByTestId('consent-document').fill('GT-2026');
  await sheet.getByTestId('consent-version').fill('1');
  await sheet.getByTestId('consent-document').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await settle(page);
  await shot(page, P, '05-photo-added', { el: sheet });

  // 6. Save, then the consent on file.
  await sheet.getByTestId('consent-save').click();
  await expect(sheet).toBeHidden({ timeout: 30_000 });
  const general = policies.locator('[data-consent-section="general"]');
  await expect(general.getByText('Signed', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await noToasts(page);
  await expect(page.getByTestId('consent-undo-bar')).toBeHidden({ timeout: 20_000 }).catch(() => {});
  await general.evaluate(el => el.scrollIntoView({ block: 'start' }));
  await settle(page);
  await shot(page, P, '06-consent-signed');

  // 7. Withdraw: the reason step (cancelled, the consent stays signed).
  await general.getByRole('button', { name: /^Withdraw/ }).first().click();
  await expect(sheet).toBeVisible();
  await shot(page, P, '07-withdraw', { el: sheet });
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });
});
