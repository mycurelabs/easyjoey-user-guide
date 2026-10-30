import { expect, test, type Page } from '@playwright/test';
import { settle, shot, signIn } from './helpers';
import { noToasts, openSettingsAt, patientWithEncounter } from './visits.lib';

const P = 'finish-the-visit';
const PAOLO = {
  firstName: 'Paolo',
  lastName: 'Mendoza',
  sex: 'male' as const,
  dateOfBirth: '2001-11-05',
  mobileNo: '0917 000 0033',
};

const top = (page: Page) => page.getByRole('dialog').filter({ visible: true }).last();
const status = (page: Page) => page.getByTestId('encounter-status');
const step = (page: Page) => page.getByTestId('reason-step').filter({ visible: true });

async function openEncounter(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId('encounter-paper')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('encounter-step')).toBeVisible({ timeout: 60_000 });
  await noToasts(page);
}

/** Settings › Encounter › Require a diagnosis before closing (this account's own switch). */
async function requireDiagnosis(page: Page, on: boolean): Promise<boolean> {
  await page.goto('/');
  await openSettingsAt(page, 'encounter');
  const sw = page.getByTestId('enc-diagnosis');
  await expect(sw).toBeVisible({ timeout: 30_000 });
  await expect(sw).toBeEnabled({ timeout: 30_000 });
  const isOn = async () =>
    (await sw.getAttribute('aria-checked')) === 'true' || (await sw.getAttribute('data-state')) === 'checked';
  const before = await isOn();
  if (before !== on) await sw.click();
  await expect.poll(isOn, { timeout: 15_000 }).toBe(on);
  await settle(page);
  return before;
}

test('finish the visit', async ({ page }) => {
  test.setTimeout(480_000); // WebKit runs these long flows slower than the default 3 minutes
  await signIn(page);

  // ── An encounter opened by mistake: Archive…, then Restore. ──────────────
  const first = await patientWithEncounter(page, PAOLO);
  await openEncounter(page, first.url);

  // 1. The ⌄ beside End encounter, before anything is recorded.
  await page.getByTestId('encounter-step-more').click();
  await expect(page.getByTestId('encounter-step-item-archive')).toBeVisible();
  await shot(page, P, '01-actions-menu');

  // 2. Archive…: the reason step.
  await page.getByTestId('encounter-step-item-archive').click();
  await expect(step(page)).toBeVisible();
  await step(page).getByText('Opened by mistake', { exact: true }).click();
  await shot(page, P, '02-archive', { el: step(page) });
  await step(page).getByTestId('reason-confirm').click();
  await expect(status(page)).toHaveText('Archived', { timeout: 30_000 });
  // WebKit keeps the closing sheet on screen a moment longer.
  await expect(step(page)).toHaveCount(0, { timeout: 15_000 });
  await noToasts(page);
  await shot(page, P, '03-archived');

  // 3. Restore brings it back as ended.
  await page.getByTestId('status-band-action').click();
  await expect(status(page)).not.toHaveText('Archived', { timeout: 30_000 });

  // ── A normal visit: the diagnosis rule, End encounter, Reopen. ───────────
  const visit = await patientWithEncounter(page, PAOLO);
  const wasOn = await requireDiagnosis(page, true);
  try {
    await openEncounter(page, visit.url);
    await page.getByTestId('add-chief-complaint').click();
    await top(page).getByRole('textbox', { name: /Chief complaint/ }).fill('Sore throat since yesterday');
    await top(page).getByTestId('record-editor-save').click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
    await noToasts(page);

    // 4. End encounter without a diagnosis: held back.
    await page.getByTestId('encounter-step-end').click();
    const held = page.locator('[data-sonner-toast]').filter({ hasText: 'Add a diagnosis before ending this encounter' });
    await expect(held).toBeVisible({ timeout: 15_000 });
    await shot(page, P, '04-diagnosis-required');
    await noToasts(page);

    // Add the diagnosis.
    await page.getByTestId('add-diagnosis').click();
    await top(page).getByTestId('icd-search').fill('J02.9');
    await top(page).getByTestId('icd-option').filter({ hasText: 'J02.9' }).first().click();
    await top(page).getByTestId('record-editor-save').click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
    await noToasts(page);

    // 5. End encounter: the confirmation.
    await page.getByTestId('encounter-step-end').click();
    const confirm = page.getByTestId('end-encounter-dialog');
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await shot(page, P, '05-end-confirm', { el: confirm });

    // 6. End early…: the reasons (cancelled here).
    await confirm.getByTestId('end-early').click();
    await expect(step(page)).toBeVisible();
    await shot(page, P, '06-end-early', { el: step(page) });
    await step(page).getByTestId('reason-keep').click();
    await expect(step(page)).toHaveCount(0);

    // 7. End encounter.
    await page.getByTestId('encounter-step-end').click();
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await confirm.getByTestId('end-confirm').click();
    await expect(status(page)).toHaveText('Ended', { timeout: 30_000 });
    await expect(page.getByTestId('encounter-step-reopen')).toBeVisible({ timeout: 30_000 });
    // The confirm sheet slides away after the status changes; WebKit is slow to finish it.
    await expect(confirm).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText('Ended encounter').first()).toBeVisible({ timeout: 15_000 });
    await shot(page, P, '07-ended');
    await noToasts(page);

    // 8. Reopen encounter, then end it again.
    await page.getByTestId('encounter-step-reopen').click();
    await expect(status(page)).toHaveText('Active', { timeout: 30_000 });
    await noToasts(page);
    await page.getByTestId('encounter-step-end').click();
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await confirm.getByTestId('end-confirm').click();
    await expect(status(page)).toHaveText('Ended', { timeout: 30_000 });
  } finally {
    // Put the setting back the way it was.
    await requireDiagnosis(page, wasOn);
  }
});
