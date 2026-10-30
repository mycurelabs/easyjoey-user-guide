// Appointments, part two: the Day view, an online booking request and its
// "Who is this booking for?" step, and No-show.
//
// The online request is one the clinic's public booking page made (see
// bookOnline below). Re-running: each run first cancels the earlier run's
// open bookings for these made-up people; a linked request is then theirs.
import { expect as baseExpect, test, type Page } from '@playwright/test';
import { settle, shot, signIn } from './helpers';
import { facilityOf, get, patch, patient, post, serviceByName } from './payments-fixtures';

const expect = baseExpect.configure({ timeout: 60_000 });
const P = 'appointments';

// Made-up people (this repo is public).
const LIZA = {
  firstName: 'Liza',
  lastName: 'Navarro',
  sex: 'female' as const,
  dateOfBirth: '1991-04-07',
  mobileNo: '09170000051',
  email: 'liza.navarro@ej.test',
};
const RAMON = {
  firstName: 'Ramon',
  lastName: 'Dizon',
  sex: 'male' as const,
  dateOfBirth: '1968-12-02',
  mobileNo: '0917 000 0052',
  email: 'ramon.dizon@ej.test',
};
const SLUG = 'masigla-guide-demo';

/** A time from the server: epoch ms or an ISO date. */
const ms = (v: unknown) => (typeof v === 'number' ? v : Date.parse(String(v)));
const toast = (page: Page, text: RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text }).first();

async function cancelOpen(page: Page, facility: string, match: (b: any) => boolean) {
  const res = await get(page, `booking/bookings?organization=${facility}&status=pending,confirmed&$limit=500`);
  for (const b of res.data ?? []) {
    if (match(b) && ['pending', 'confirmed'].includes(b.status))
      await post(page, `booking/bookings/${b.id}/cancel`, { reason: 'Guide re-run' }).catch(() => {});
  }
}

/** A request through the clinic's public booking page, switched on for it and off again after. */
async function bookOnline(page: Page, facility: string, serviceId: string) {
  const org = await get(page, `organizations/${facility}`);
  await patch(page, `organizations/${facility}`, {
    configAppointments: { ...(org?.configAppointments ?? {}), publicPage: { enabled: true, slug: SLUG, serviceIds: [serviceId] } },
  });
  try {
    const from = new Date();
    const to = new Date(from.getTime() + 7 * 86_400_000);
    const slots = await page.request.get(
      `/api/public/clinics/${SLUG}/slots?service=${serviceId}&from=${from.toISOString()}&to=${to.toISOString()}`,
    );
    if (!slots.ok()) throw new Error(await slots.text());
    const free = (await slots.json()).data ?? [];
    if (!free.length) throw new Error('no free online time');
    const res = await page.request.post(`/api/public/clinics/${SLUG}/bookings`, {
      data: {
        serviceId,
        startTime: free[0].startTime,
        name: 'Liza Navarro',
        mobile: '0917 000 0051',
        email: LIZA.email,
        note: 'Cough for one week',
        relationship: 'self',
        consent: true,
      },
    });
    if (!res.ok()) throw new Error(await res.text());
  } finally {
    // Off again (a page can be turned off, not removed).
    const now = await get(page, `organizations/${facility}`);
    await patch(page, `organizations/${facility}`, {
      configAppointments: { ...(now?.configAppointments ?? {}), publicPage: { enabled: false } },
    });
  }
}

async function chooseView(page: Page, name: 'Day' | 'Week' | 'Month') {
  const calendar = page.locator('[data-appointments-mode] [data-segmented-key="calendar"]');
  if ((await calendar.getAttribute('aria-pressed')) !== 'true') await calendar.click();
  await page.locator('[data-calendar-period-trigger]').click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('appointments, more', async ({ page }) => {
  test.setTimeout(900_000);
  await signIn(page);
  const facility = await facilityOf(page);
  const ramon = await patient(page, facility, RAMON);
  // Liza has been to the clinic before: her record holds the same mobile and email.
  const liza = await patient(page, facility, LIZA);
  await cancelOpen(page, facility, b => b.client === ramon);
  await cancelOpen(page, facility, b => b.client === liza);

  const events = await get(page, `booking/events?organization=${facility}&$limit=100`);
  const eventId = (events.data ?? []).find((e: any) => e.tags?.includes('easyjoey-clinic-hours'))?.id;
  expect(eventId, 'the clinic hours schedule').toBeTruthy();

  // Ramon: confirmed for a minute from now, so No-show opens 5 minutes after that.
  const ramonStart = new Date(Date.now() + 75_000);
  ramonStart.setSeconds(0, 0);
  const rb = await page.request.post('/api/booking/bookings', {
    data: {
      event: eventId,
      client: ramon,
      scheduledAt: ramonStart.toISOString(),
      durationMinutes: 30,
      type: 'appointment',
      reason: 'Follow-up',
    },
  });
  expect(rb.ok(), `Ramon's booking: ${await rb.text()}`).toBeTruthy();
  const ramonBooking = await rb.json();
  await post(page, `booking/bookings/${ramonBooking.id}/confirm`);

  // Liza's online request: a new one through the booking page when it opens,
  // else one already waiting (the page stays closed on a demo stack whose
  // licence can't be verified; such a request is then added beforehand with
  // the same fields the booking page writes).
  const consult = await serviceByName(page, facility, 'Consultation');
  await bookOnline(page, facility, consult.id).catch(e => console.log(`booking page closed: ${e.message}`));
  const online = (
    await get(page, `booking/bookings?organization=${facility}&status=pending&$limit=500`)
  ).data
    .filter((b: any) => !b.client && b.formResponses?.data?.email === LIZA.email && ms(b.scheduledAt) > Date.now())
    .sort((a: any, b: any) => ms(a.scheduledAt) - ms(b.scheduledAt))[0];
  expect(online, 'an online request from Liza waiting in the clinic').toBeTruthy();
  const requestStart = ms(online.scheduledAt);

  // Did the request make a notification? (Recorded for the report.)
  const notes = await get(page, `notifications?$sort[createdAt]=-1&$limit=20`).catch(() => ({ data: [] }));
  const notified = (notes.data ?? []).some((n: any) => n?.meta?.id === online.id);
  console.log(`online request ${online.id} at ${online.scheduledAt}; notified=${notified}`);

  // The list: the request shows the requester's name and "Online booking".
  await page.goto(`/appointments?view=list`);
  await expect(page.getByText(/Liza Navarro · Online booking/).filter({ visible: true }).first()).toBeVisible();
  await page.getByText(/Liza Navarro · Online booking/).filter({ visible: true }).first().evaluate(el => el.scrollIntoView({ block: 'center' }));
  await settle(page);
  await shot(page, P, '12-online-request-list');

  // Its sheet.
  await page.goto(`/appointments?view=list&appt=${online.id}`);
  await expect(page.getByTestId('link-note')).toBeVisible();
  await settle(page);
  await shot(page, P, '13-online-request');

  // Confirm asks who it's for.
  await page.getByTestId('primary-action').click();
  const step = page.getByTestId('link-patient-step');
  await expect(step).toBeVisible();
  await expect(page.getByTestId('link-match').first()).toBeVisible();
  await page.getByTestId('link-match').first().locator('input').check();
  await expect(page.getByTestId('link-submit')).toHaveText('Link and confirm');
  await settle(page);
  await shot(page, P, '14-link-patient');

  // A new patient instead: prefilled from the request.
  await page.getByTestId('link-new').check();
  await expect(page.getByTestId('link-submit')).toHaveText('Create patient and confirm');
  await page.locator('#link-email').scrollIntoViewIfNeeded();
  await settle(page);
  await shot(page, P, '15-link-new-patient');

  // Link to Liza's record and confirm.
  await page.getByTestId('link-match').first().locator('input').check();
  await page.getByTestId('link-submit').click();
  await expect(toast(page, /^Confirmed /)).toBeVisible();

  // Day view, on the day after the request (a day of plain bookings).
  const day = new Date(requestStart + 8 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
  await page.goto(`/appointments?view=week&date=${day}`);
  await expect(page.locator('[data-slot="day-column"]').first()).toBeVisible();
  await chooseView(page, 'Day');
  await expect(page.locator('[data-slot="day-column"]')).toHaveCount(1);
  await page.locator('body').evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await settle(page);
  await shot(page, P, '17-calendar-day');

  // No-show: from 5 minutes after Ramon's start.
  const wait = ramonStart.getTime() + 5 * 60_000 + 20_000 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  await page.goto(`/appointments?view=list&appt=${ramonBooking.id}`);
  const noShow = page.getByTestId('secondary-noShow');
  await expect(noShow).toBeVisible();
  await settle(page);
  await shot(page, P, '18-no-show-button');
  await noShow.click();
  const marked = toast(page, /as a no-show/);
  await expect(marked).toBeVisible();
  await settle(page);
  await shot(page, P, '19-no-show-undo');
  // Leave it marked: going to another page sends it.
  await page.goto('/');
  await expect(page.getByTestId('page-title')).toBeVisible({ timeout: 90_000 });
});
