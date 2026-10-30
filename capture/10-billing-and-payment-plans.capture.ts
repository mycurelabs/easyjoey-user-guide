import { expect as baseExpect, test, type Page } from '@playwright/test';
import { settle, shot, signIn } from './helpers';
import { facilityOf, get, patient, shotBox } from './payments-fixtures';

// The demo machine can be busy (several captures at once): allow slow writes.
const expect = baseExpect.configure({ timeout: 60_000 });

const P = 'billing-and-payment-plans';

// Made-up patients (this repo is public).
const ANDREA = {
  firstName: 'Andrea',
  lastName: 'Villanueva',
  sex: 'female' as const,
  dateOfBirth: '1995-09-18',
  mobileNo: '0917 000 0043',
  email: 'andrea.villanueva@ej.test',
};

const boot = { timeout: 180_000 };

/** The first of the month after next, as the plan's first installment date. */
function firstDue() {
  const d = new Date();
  const m = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 2, 1));
  return m.toISOString().slice(0, 10);
}

/**
 * Andrea's issued plan from an earlier run, if any. An issued plan keeps its
 * invoice number and can't be deleted, so later runs reuse it instead of
 * issuing another (the lists would show a new copy every run).
 */
async function issuedPlan(page: Page, facility: string, patientId: string) {
  const res = await get(page, `billing-invoices?facility=${facility}&subject=${patientId}&tags=payment-plan&$expand=items&$limit=50`);
  const live = (res.data ?? []).filter(
    (i: any) => i.subject === patientId && i.finalizedAt && (i.items ?? []).some((x: any) => !x.voidedAt),
  );
  return live[0]?.id ? String(live[0].id) : null;
}

/** Removes Andrea's plans that were never issued (a run that stopped halfway leaves one). */
async function removeDrafts(page: Page, facility: string, patientId: string) {
  const res = await get(page, `billing-invoices?facility=${facility}&subject=${patientId}&tags=payment-plan&$limit=50`);
  for (const i of res.data ?? []) {
    if (i.subject === patientId && !i.finalizedAt) await page.request.delete(`/api/billing-invoices/${i.id}`);
  }
}

test('billing, balances and payment plans', async ({ page }) => {
  test.setTimeout(900_000);
  await signIn(page);
  const facility = await facilityOf(page);
  const andrea = await patient(page, facility, ANDREA);
  const kept = await issuedPlan(page, facility, andrea);
  await removeDrafts(page, facility, andrea);

  // Transactions (the default tab).
  await page.goto('/billing');
  await expect(page.getByRole('tab', { name: 'Transactions' }).first()).toBeVisible(boot);
  await expect(page.getByRole('row').nth(1)).toBeVisible(boot);
  await shot(page, P, '01-transactions');

  await page.goto('/billing?tab=sales');
  await expect(page.getByRole('row').nth(1)).toBeVisible(boot);
  await shot(page, P, '02-total-sales');

  // Payments due and a row's actions.
  await page.goto('/billing?tab=balances');
  await expect(page.getByRole('row').nth(1)).toBeVisible(boot);
  await shot(page, P, '03-payments-due');
  await page.getByRole('button', { name: /^More actions for / }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Collect at the cashier' })).toBeVisible();
  await shot(page, P, '04-row-actions');
  await page.keyboard.press('Escape');

  // Accounts receivable: what HMOs and PhilHealth owe.
  await page.goto('/billing?tab=receivables');
  await expect(page.getByRole('row').nth(1)).toBeVisible(boot);
  await shot(page, P, '06-accounts-receivable');
  const claim = page.getByRole('button', { name: /^More actions for / }).first();
  if (await claim.isVisible({ timeout: 60_000 }).catch(() => false)) {
    await claim.click();
    await expect(page.getByRole('menuitem').first()).toBeVisible();
    await shot(page, P, '07-claim-actions');
    await page.keyboard.press('Escape');
  }

  // Payment plans: drafted from the patient's own Billing tab (the patient is filled in).
  await page.goto(`/patients/${andrea}?tab=billing&view=plans`);
  await page.getByTestId('create-payment-plan').first().click();
  await expect(page.getByTestId('plan-patient-locked')).toContainText('Villanueva', boot);
  await page.getByTestId('plan-title').fill('Minor surgery and follow-up visits');
  await page.getByTestId('plan-total').fill('12000');
  await page.getByTestId('plan-deposit').fill('3000');
  await page.getByTestId('plan-count').fill('3');
  await page.getByTestId('plan-first-due').fill(firstDue());
  await page.getByTestId('plan-payer').fill('Andrea Villanueva');
  await page.getByTestId('plan-relationship').selectOption('Patient');
  await page.getByTestId('plan-inclusions').fill('Minor surgery, dressing changes and two follow-up visits.');
  await page.getByTestId('plan-exclusions').fill('Medicines and outside laboratory tests.');
  await shot(page, P, '09-create-payment-plan', { at: page.getByTestId('plan-patient-locked') });
  await page.getByTestId('plan-save-new').click();
  await expect(page).toHaveURL(/\/billing\/payment-plans\/(?!new)[^/?]+/, boot);
  await expect(page.getByTestId('plan-offer')).toBeVisible(boot);
  await settle(page);
  await shot(page, P, '10-plan-draft');

  await page.getByTestId('plan-offer').click();
  await expect(page.getByRole('status').filter({ hasText: 'No message was sent' })).toBeVisible();
  await page.getByTestId('plan-accept').click();
  await expect(page.getByTestId('accept-save')).toBeVisible();
  await page.getByTestId('accept-by').fill('Andrea Villanueva');
  await page.getByTestId('accept-capacity').selectOption('Patient');
  await page.getByTestId('accept-method').selectOption('Written agreement recorded');
  await page.getByTestId('accept-ack').check();
  await shotBox(page, P, '11-record-acceptance', page.getByRole('dialog').first());
  await page.getByTestId('accept-save').click();
  await expect(page.getByTestId('accept-save')).toBeHidden(boot);

  await page.getByTestId('plan-issue').click();
  await page.getByTestId('issue-ack').check();
  await shotBox(page, P, '12-issue-invoice', page.getByRole('dialog').first());
  if (kept) {
    // Reuse the plan issued on the first run; this run's draft is removed (drafts can be).
    const draft = new URL(page.url()).pathname.split('/').pop();
    await page.getByRole('button', { name: 'Keep agreement only' }).click();
    expect((await page.request.delete(`/api/billing-invoices/${draft}`)).ok(), 'draft plan removed').toBe(true);
    await page.goto(`/billing/payment-plans/${kept}`);
  } else {
    await page.getByTestId('issue-save').click();
  }
  await expect(page.locator('[data-plan-schedule]')).toBeVisible(boot);
  await settle(page);
  await shot(page, P, '13-plan-issued');

  await page.getByTestId('plan-record-payment').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('payment-obligations')).toBeVisible(boot);
  await shotBox(page, P, '14-plan-record-payment', sheet.first());
  await page.keyboard.press('Escape');

  // Billing › Payment plans lists it.
  await page.goto('/billing?tab=plans&planSearch=Villanueva&planScope=outstanding');
  await expect(page.locator('[data-payment-plans]').first()).toContainText('Villanueva', boot);
  await settle(page);
  await shot(page, P, '08-payment-plans');

  // A patient's own Billing tab: Andrea's down payment is due now, the installments later.
  await page.goto(`/patients/${andrea}?tab=billing`);
  await expect(page.getByRole('tab', { name: 'Billing' }).first()).toBeVisible(boot);
  await settle(page);
  await shot(page, P, '15-patient-billing');
});
