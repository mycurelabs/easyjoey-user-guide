// Re-running: each run cancels its earlier open bookings for these patients first.
// A checked-in booking can't be cancelled, so the calendar keeps one per run for
// Josefina on the day the capture ran.
import { expect as baseExpect, test, type Page } from '@playwright/test';
import { settle, shot, signIn } from './helpers';
import { facilityOf, get, patient, post } from './payments-fixtures';

// The demo machine can be busy (several captures at once): allow slow writes.
const expect = baseExpect.configure({ timeout: 60_000 });

const P = 'appointments';

// Made-up patients (this repo is public).
const ANDREA = {
  firstName: 'Andrea',
  lastName: 'Villanueva',
  sex: 'female' as const,
  dateOfBirth: '1995-09-18',
  mobileNo: '0917 000 0043',
  email: 'andrea.villanueva@ej.test',
};
const JOSEFINA = {
  firstName: 'Josefina',
  lastName: 'Cruz',
  sex: 'female' as const,
  dateOfBirth: '1950-02-11',
  mobileNo: '0917 000 0041',
  email: 'josefina.cruz@ej.test',
};

const toast = (page: Page, text: RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text }).first();

async function cancelOpenBookings(page: Page, facility: string, client: string) {
  const res = await get(page, `booking/bookings?organization=${facility}&client=${client}&$limit=100`);
  for (const b of res.data ?? []) {
    if (b.client === client && ['pending', 'confirmed'].includes(b.status))
      await post(page, `booking/bookings/${b.id}/cancel`, { reason: 'Guide re-run' }).catch(() => {});
  }
}

async function chooseView(page: Page, name: 'Day' | 'Week' | 'Month' | 'List') {
  const mode = page.locator('[data-appointments-mode]');
  if (name === 'List') return mode.locator('[data-segmented-key="list"]').click();
  const calendar = mode.locator('[data-segmented-key="calendar"]');
  if ((await calendar.getAttribute('aria-pressed')) !== 'true') await calendar.click();
  await page.locator('[data-calendar-period-trigger]').click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('appointments', async ({ page }) => {
  test.setTimeout(900_000);
  await signIn(page);
  const facility = await facilityOf(page);
  const andrea = await patient(page, facility, ANDREA);
  const josefina = await patient(page, facility, JOSEFINA);
  await cancelOpenBookings(page, facility, andrea);
  await cancelOpenBookings(page, facility, josefina);
  const events = await get(page, `booking/events?organization=${facility}&$limit=100`);
  const eventId = (events.data ?? []).find((e: any) => e.tags?.includes('easyjoey-clinic-hours'))?.id;
  expect(eventId, 'the clinic hours schedule').toBeTruthy();

  // Josefina is booked for later today (confirmed), so she can be checked in:
  // the first free half hour from 20 minutes from now.
  const start = new Date(Date.now() + 20 * 60_000);
  start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
  let today: any = null;
  for (let i = 0; i < 16 && !today; i++, start.setMinutes(start.getMinutes() + 30)) {
    const res = await page.request.post('/api/booking/bookings', {
      data: {
        event: eventId,
        client: josefina,
        scheduledAt: start.toISOString(),
        durationMinutes: 30,
        type: 'appointment',
        reason: 'Follow-up',
        note: 'Blood pressure check',
      },
    });
    if (res.ok()) today = await res.json();
  }
  expect(today, 'a free time later today for Josefina').toBeTruthy();
  await post(page, `booking/bookings/${today.id}/confirm`);

  await page.goto('/appointments?view=week');
  await expect(page.locator('[data-slot="day-column"]').first()).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await shot(page, P, '01-calendar-week');

  await chooseView(page, 'Month');
  await expect(page.locator('[data-slot="month-view"]')).toBeVisible();
  await settle(page);
  await shot(page, P, '02-calendar-month');

  await chooseView(page, 'List');
  await expect(page.getByTestId('kpi-tile').first()).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await shot(page, P, '03-list');

  // Book Andrea, not yet confirmed.
  await page.getByTestId('new-appointment').click();
  const booking = page.getByTestId('billing-sheet');
  await expect(booking).toBeVisible();
  await page.getByTestId('patient-picker-input').fill('Villanueva');
  await page.getByRole('option', { name: /Villanueva, Andrea/ }).first().click();
  await page.locator('#bk-note').fill('Wound check after minor surgery');
  await settle(page);
  await shot(page, P, '04-new-appointment');
  const chip = page.getByTestId('time-chip').first();
  const next = page.getByTestId('next-available');
  await expect(chip.or(next).first()).toBeVisible({ timeout: 60_000 });
  if (await next.isVisible()) await next.click();
  // A time later in the list, so today's booking for Josefina stays clear.
  const chips = page.getByTestId('time-chip');
  await chips.nth(Math.min(4, (await chips.count()) - 1)).click();
  await page.getByRole('button', { name: 'Not yet confirmed', exact: true }).click();
  await settle(page);
  await shot(page, P, '05-date-and-time');

  await page.getByTestId('booking-submit').click();
  const booked = toast(page, /^Booked /);
  await expect(booked).toBeVisible({ timeout: 60_000 });
  // The sheet closes after booking; picture the list with the message.
  await expect(page.getByRole('dialog').filter({ hasText: 'Date and time' })).toHaveCount(0, { timeout: 60_000 }).catch(() => {});
  await shot(page, P, '06-booked');
  await booked.getByRole('button', { name: 'View', exact: true }).click();

  const sheet = page.getByTestId('billing-sheet');
  await expect(page.getByTestId('appointment-status')).toBeVisible({ timeout: 60_000 });
  const apptId = new URL(page.url()).searchParams.get('appt');
  await settle(page);
  await shot(page, P, '07-appointment-pending');

  // Confirm.
  const primary = page.getByTestId('primary-action');
  await expect(primary).toHaveText(/Confirm/);
  await primary.click();
  // Confirm closes the sheet with a "Confirmed <patient>" message.
  await expect(toast(page, /^Confirmed /)).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await shot(page, P, '07b-confirmed');
  await page.goto(`/appointments?view=list&appt=${apptId}`);
  await expect(page.getByTestId('appointment-status')).toContainText('Confirmed', { timeout: 60_000 });

  // Reschedule (shown, then closed: nothing is changed).
  await sheet.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await expect(page.getByText('Reschedule appointment')).toBeVisible();
  await settle(page);
  await shot(page, P, '08-reschedule');
  await page.keyboard.press('Escape');
  await page.goto(`/appointments?view=list&appt=${apptId}`);
  await expect(page.getByTestId('appointment-status')).toBeVisible({ timeout: 60_000 });

  // Cancel (shown, then kept).
  await sheet.getByRole('button', { name: 'Cancel appointment' }).click();
  await expect(page.getByTestId('confirm-cancel')).toBeVisible();
  await page.locator('#cancel-reason').fill('Patient asked to move to next week');
  await settle(page);
  await shot(page, P, '09-cancel');
  await page.getByRole('button', { name: 'Keep appointment' }).click();

  // Josefina arrives: check her in.
  await page.goto(`/appointments?view=list&appt=${today.id}`);
  await expect(page.getByTestId('primary-action')).toHaveText(/Check in/, { timeout: 60_000 });
  await settle(page);
  await shot(page, P, '10-check-in');
  await page.getByTestId('primary-action').click();
  const checkedIn = toast(page, /checked in/i);
  await expect(checkedIn).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await shot(page, P, '11-checked-in');
});
