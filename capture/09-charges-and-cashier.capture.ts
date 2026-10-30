import { expect as baseExpect, test } from '@playwright/test';
import { settle, shot, signIn } from './helpers';
import {
  asDoctorWithoutCollect,
  facilityOf,
  liveItems,
  newEncounter,
  patient,
  voidLeftovers,
  waitToastGone,
  shotBox,
} from './payments-fixtures';

// The demo machine can be busy (several captures at once): allow slow writes.
const expect = baseExpect.configure({ timeout: 60_000 });

const P = 'charges-and-cashier';

// Made-up patients for this page only (this repo is public).
const JOSEFINA = {
  firstName: 'Josefina',
  lastName: 'Cruz',
  sex: 'female' as const,
  dateOfBirth: '1950-02-11',
  mobileNo: '0917 000 0041',
  email: 'josefina.cruz@ej.test',
  details: {
    OSCASeniorCitizenId: 'SC-TEST-0001',
    OSCASeniorCitizenIdDeclaredAt: Date.parse('2026-01-15T00:00:00+08:00'),
  },
};
const MIGUEL = {
  firstName: 'Miguel',
  lastName: 'Torres',
  sex: 'male' as const,
  dateOfBirth: '1988-06-03',
  mobileNo: '0917 000 0042',
  email: 'miguel.torres@ej.test',
  details: {
    insuranceCards: [
      {
        id: 'guide-miguel-torres-card-1',
        status: 'active',
        insurance: 'org-hmo-mxc',
        insuranceName: 'Bayanihan Health',
        insuranceType: 'insurance',
        insuranceSubtype: 'hmo',
        number: 'BH-TEST-0001',
        membershipType: 'primary',
      },
    ],
  },
};

test('charges and the cashier', async ({ page }) => {
  test.setTimeout(900_000);
  const dialog = page.getByRole('dialog');

  // ── The doctor's side: the encounter's Charges sheet. A doctor who doesn't take
  // payments sees this sheet; anyone who collects goes straight to the Cashier.
  await asDoctorWithoutCollect(page);
  await signIn(page);
  const facility = await facilityOf(page);
  const josefina = await patient(page, facility, JOSEFINA);
  await voidLeftovers(page, facility, josefina);
  const enc = await newEncounter(page, facility, josefina);
  await page.goto(enc.url);
  const charges = page.getByTestId('bill-button');
  await expect(charges).toBeVisible({ timeout: 60_000 });
  // The visit type's service links by itself ("Invoice opened with Consultation").
  await expect.poll(async () => (await liveItems(page, enc.invoiceId)).length, { timeout: 60_000 }).toBe(1);
  await expect(page.getByText('Invoice opened with Consultation')).toBeVisible({ timeout: 60_000 });
  await shot(page, P, '01-encounter-charges');
  await waitToastGone(page, 'Invoice opened');

  await charges.click();
  const sheet = page.getByTestId('charges-sheet');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('charges-loading')).toHaveCount(0, { timeout: 60_000 });
  await expect(sheet.getByTestId('charge-line').first()).toHaveAttribute('data-included', 'true');
  await shotBox(page, P, '02-charges-sheet', sheet);

  await sheet.getByTestId('charges-add').click();
  await sheet.getByRole('searchbox').fill('cert');
  await expect(sheet.getByRole('button', { name: /Medical certificate/ }).first()).toBeVisible();
  await shotBox(page, P, '03-add-charge', sheet);
  await sheet.getByRole('button', { name: /Medical certificate/ }).first().click();
  await expect(sheet.getByTestId('charge-line')).toHaveCount(2);
  await expect(sheet.getByTestId('charges-total')).toHaveText(/1,100/);
  await waitToastGone(page, 'added to the invoice');
  await shotBox(page, P, '04-charges-added', sheet);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // End the encounter: the bill moves to the Cashier's Waiting list.
  await page.getByRole('button', { name: 'End encounter' }).first().click();
  const end = page.getByRole('dialog').filter({ hasText: 'End this encounter?' });
  await expect(end).toBeVisible();
  await shotBox(page, P, '05-end-encounter', end);
  await end.getByRole('button', { name: 'End encounter', exact: true }).click();
  await expect(end).toHaveCount(0, { timeout: 60_000 });

  // ── The cashier's side (the owner, who takes payments).
  await page.unroute('**/api/organization-members**');
  await page.goto('/cashier');
  const row = page.locator(`[data-cashier-row="${enc.invoiceId}"]`);
  await expect(row).toBeVisible({ timeout: 60_000 });
  await shot(page, P, '06-cashier-waiting');

  await page.locator('[data-cashier-lists] button, [data-cashier-lists] [role=combobox]').first().click();
  await expect(page.locator('[role=menu], [role=listbox]').filter({ hasText: 'Paid today' }).first()).toBeVisible();
  await shot(page, P, '07-cashier-lists');
  await page.keyboard.press('Escape');

  await row.click();
  await expect(page.getByTestId('invoice-title')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('invoice-balance')).toHaveText(/1,100/);
  await shot(page, P, '08-invoice');

  // Senior Citizen discount: the ID on file fills in.
  await page.getByTestId('invoice-discount-action').click();
  await dialog.getByTestId('discount-kind-senior').click().catch(() => {});
  await expect(dialog.getByTestId('discount-id')).toHaveValue('SC-TEST-0001');
  await expect(dialog.getByTestId('discount-preview-total')).toHaveText(/880/, { timeout: 60_000 });
  await shotBox(page, P, '09-discount', dialog.first());
  await dialog.getByTestId('discount-submit').click();
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  await waitToastGone(page, 'discount applied');
  await expect(page.getByTestId('invoice-balance')).toHaveText(/880/);
  await shot(page, P, '10-invoice-discounted');

  // Collect in cash.
  await page.getByTestId('invoice-collect').click();
  await expect(dialog.getByTestId('collect-methods')).toBeVisible();
  await dialog.locator('[data-collect-methods] label').filter({ hasText: 'Cash' }).first().click();
  await expect(dialog.getByTestId('collect-tendered')).toBeVisible();
  await dialog.getByTestId('collect-quick').getByRole('button').nth(1).click();
  await expect(dialog.getByTestId('collect-change')).toBeVisible();
  await dialog.getByTestId('collect-change').scrollIntoViewIfNeeded();
  await shotBox(page, P, '11-collect', dialog.first());
  await dialog.getByTestId('collect-submit').click();
  await expect(dialog.getByTestId('collect-receipt')).toHaveCount(1, { timeout: 180_000 });
  await shotBox(page, P, '12-receipt', dialog.first());
  await page.waitForTimeout(800);
  await dialog.getByTestId('collect-done').click();
  await expect(page.getByTestId('invoice-status')).toHaveText('Paid', { timeout: 60_000 });

  await page.getByTestId('invoice-print').click();
  await expect(dialog.getByTestId('invoice-paper')).toBeVisible({ timeout: 60_000 });
  await shot(page, P, '13-print');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });

  await page.getByTestId('invoice-more').click();
  await expect(page.getByTestId('invoice-more-void')).toBeVisible();
  await shot(page, P, '14-more-menu');
  await page.getByTestId('invoice-more-void').click();
  await expect(dialog.getByTestId('void-sheet')).toBeVisible();
  await shotBox(page, P, '15-void', dialog.first());
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });

  // ── Coverage: Miguel's Bayanihan Health card covers the consultation, not the certificate.
  const miguel = await patient(page, facility, MIGUEL);
  await voidLeftovers(page, facility, miguel);
  const menc = await newEncounter(page, facility, miguel);
  await page.goto(menc.url);
  await expect(page.getByTestId('bill-button')).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await liveItems(page, menc.invoiceId)).length, { timeout: 60_000 }).toBeGreaterThan(0);
  await page.goto(`/cashier/invoices/${menc.invoiceId}`);
  await expect(page.getByTestId('invoice-title')).toBeVisible({ timeout: 60_000 });
  const cert = page.getByRole('button', { name: /^Add Medical certificate/ }).or(
    page.locator('li, div').filter({ hasText: /^Medical certificate/ }).getByRole('button', { name: 'Add', exact: true }),
  ).first();
  await cert.click();
  await expect(page.getByTestId('invoice-line')).toHaveCount(2, { timeout: 60_000 }).catch(async () => {
    await expect(page.getByTestId('invoice-line').filter({ visible: true })).toHaveCount(2, { timeout: 60_000 });
  });
  await waitToastGone(page, /added/i);
  await page.getByTestId('invoice-coverage-action').click();
  await expect(dialog.getByTestId('coverage-payers')).toBeVisible();
  const partner = dialog.getByTestId('coverage-partners').locator('label').filter({ hasText: 'Bayanihan Health' });
  if (!(await partner.locator('input').isChecked())) await partner.click();
  await dialog.getByTestId('coverage-approval').fill('LOA-TEST-0001');
  await expect(dialog.getByTestId('coverage-patient-pays')).toHaveText(/300/, { timeout: 60_000 });
  await shotBox(page, P, '16-coverage', dialog.first());
  await dialog.getByTestId('coverage-submit').click();
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  await waitToastGone(page, /coverage applied/i);
  await expect(page.getByTestId('invoice-collect')).toHaveText(/300/);
  await shot(page, P, '17-invoice-covered', {
    at: page.getByTestId('cashier-invoice').getByTestId('invoice-breakdown').first(),
  });

  // New sale.
  await page.goto('/cashier');
  await page.getByRole('button', { name: 'New sale' }).first().click();
  const sale = page.getByRole('dialog').filter({ hasText: 'Start sale' });
  await expect(sale).toBeVisible();
  await settle(page);
  await shotBox(page, P, '18-new-sale', sale);
  await page.keyboard.press('Escape');
});
