// Settings › Users and access (inviting a colleague) and Referral partners.
//
// The invitation goes to a made-up @ej.test address (on the demo stack the
// email lands in its local test mailbox) and is revoked at the end, so the
// clinic is left as it was. The referral partner form is filled, then
// cancelled: nothing is saved.
import { expect as baseExpect, test, type Page } from '@playwright/test';
import { settle, shot, signIn } from './helpers';
import { openSettingsAt } from './visits.lib';

const expect = baseExpect.configure({ timeout: 30_000 });
const P = 'settings-basics';
const INVITEE = 'carmen.reyes@ej.test';

const pane = (page: Page) => page.getByTestId('settings-pane').filter({ visible: true }).first();

/** Revokes a pending invitation to the invitee left by an earlier run. */
async function revokeLeftover(page: Page) {
  const row = page.getByTestId('access-user-list').getByRole('button').filter({ hasText: INVITEE });
  if (!(await row.count())) return;
  await row.first().click();
  await page.getByTestId('access-revoke').click();
  await page.getByTestId('access-revoke-confirm').click();
  await expect(page.getByTestId('access-notice')).toContainText('Revoked');
}

test('settings, team', async ({ page }) => {
  await signIn(page);
  await page.goto('/');
  await expect(page.getByTestId('page-title')).toBeVisible({ timeout: 90_000 });
  await openSettingsAt(page, 'users');
  await expect(page.getByTestId('access-user-list')).toBeVisible();
  await revokeLeftover(page);

  // Roles and permissions: the built-in roles.
  await pane(page).getByRole('tab', { name: 'Roles and permissions' }).click();
  await expect(page.getByTestId('access-role-list')).toBeVisible();
  await settle(page);
  await shot(page, P, '04b-roles');
  await pane(page).getByRole('tab', { name: 'Users' }).click();
  await expect(page.getByTestId('access-user-list')).toBeVisible();

  // Invite user: email and role.
  await page.getByTestId('access-primary-action').click();
  await expect(page.getByTestId('access-editor-title')).toHaveText('Invite user');
  await page.getByTestId('access-email').fill(INVITEE);
  await page.locator('#access-role').selectOption({ label: 'Receptionist' });
  await expect(page.getByTestId('access-configured-count')).toBeVisible();
  await page.getByTestId('access-email').blur();
  await settle(page);
  await shot(page, P, '04c-invite-form');

  // Review, then send.
  await page.getByTestId('access-submit').click();
  await expect(page.getByTestId('access-review')).toBeVisible();
  await settle(page);
  await shot(page, P, '04d-invite-review');
  await page.getByTestId('access-submit').click();
  await expect(page.getByTestId('access-notice')).toContainText('Invited');
  await settle(page);
  await shot(page, P, '04e-invited');

  // The invitation: Resend or Revoke; its role can still change.
  await page.getByTestId('access-user-list').getByRole('button').filter({ hasText: INVITEE }).first().click();
  await expect(page.getByTestId('access-invitation-note')).toBeVisible();
  await settle(page);
  await shot(page, P, '04f-invitation');

  // Leave the clinic as it was: revoke it.
  await page.getByTestId('access-revoke').click();
  await expect(page.getByTestId('access-revoke-dialog')).toBeVisible();
  await page.getByTestId('access-revoke-confirm').click();
  await expect(page.getByTestId('access-notice')).toContainText('Revoked');

  // Referral partners: the add form, filled and cancelled.
  await page.getByTestId('settings-nav-partners').filter({ visible: true }).first().click();
  await expect(page.getByTestId('partners-panel')).toBeVisible();
  await page.getByTestId('partner-add').click();
  await page.getByTestId('partner-name').fill('Bayanihan Diagnostic Lab');
  await page.getByTestId('partner-email').fill('records@bayanihan-lab.ej.test');
  await page.getByTestId('partner-email').blur();
  await settle(page);
  await shot(page, P, '13-referral-partner');
  await page.getByTestId('partner-form').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('partner-form')).toHaveCount(0);
});
