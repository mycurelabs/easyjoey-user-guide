import { expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { appE2e } from './app-e2e';
import { settle } from './helpers';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/assets');

/**
 * API helpers for the payments and schedule captures (09–11), modelled on the
 * app's own e2e fixtures (charges-5466, cashier-discount-coverage-5494). Calls
 * go through the app's /api proxy as the signed-in demo account. Every patient
 * is made up and reused across runs by name.
 */

type Fx = {
  api(page: Page, path: string): Promise<any>;
  post(page: Page, path: string, data?: Record<string, unknown>): Promise<any>;
  patch(page: Page, path: string, data?: Record<string, unknown>): Promise<any>;
};
// The app's own /api helpers (apps/easyjoey/e2e/patient-page.fixtures.ts).
const fixtures = () => appE2e<Fx>('patient-page.fixtures.ts');

export async function get(page: Page, path: string) {
  return (await fixtures()).api(page, path);
}
/** POST through the app's helper; a list body (bulk create) is sent as is. */
export async function post(page: Page, path: string, data: unknown = {}) {
  return (await fixtures()).post(page, path, data as Record<string, unknown>);
}
export async function patch(page: Page, path: string, data: Record<string, unknown> = {}) {
  return (await fixtures()).patch(page, path, data);
}

/** The signed-in account's clinic (the session's, else its top-level membership). */
export async function facilityOf(page: Page): Promise<string> {
  const session = await get(page, 'auth/get-session');
  const active = session?.session?.activeOrganizationId;
  if (active) return String(active);
  const members = (await get(page, `organization-members?uid=${session.user.id}&$limit=20`)).data ?? [];
  const id = members[0]?.organization;
  expect(id, 'an account with a clinic').toBeTruthy();
  return String(id);
}

export interface Person {
  firstName: string;
  lastName: string;
  sex: 'male' | 'female';
  dateOfBirth: string;
  mobileNo?: string;
  email?: string;
  details?: Record<string, unknown>;
}

const archived = (p: any) => Object.keys(p ?? {}).some(k => /archived/i.test(k) && p[k]);

/**
 * The person's patient record, created once and reused on later runs (matched by
 * name, re-checked by its own fields since an ignored filter returns anyone).
 * `details` are written on every run, so a re-run keeps them as the page needs.
 */
export async function patient(page: Page, facility: string, p: Person) {
  const found = await get(
    page,
    `personal-details?type=medical-patients&facility=${facility}&name.firstName=${encodeURIComponent(p.firstName)}&name.lastName=${encodeURIComponent(p.lastName)}&$limit=20`,
  );
  const hit = (found.data ?? []).find(
    (r: any) => r?.name?.firstName === p.firstName && r?.name?.lastName === p.lastName && !archived(r),
  );
  if (hit?.id) {
    if (p.details) await patch(page, `personal-details/${hit.id}`, p.details);
    return String(hit.id);
  }
  const created = await post(page, 'medical-patients', {
    facility,
    personalDetails: {
      name: { firstName: p.firstName, lastName: p.lastName },
      sex: p.sex,
      dateOfBirth: p.dateOfBirth,
      ...(p.mobileNo ? { mobileNo: p.mobileNo } : {}),
      ...(p.email ? { email: p.email } : {}),
      ...(p.details ?? {}),
    },
  });
  return String(created.id);
}

/** Ends every encounter the patient still has open (a run that stopped halfway leaves one). */
export async function finishOpenEncounters(page: Page, facility: string, patientId: string) {
  const open = await get(page, `medical-encounters?facility=${facility}&patient=${patientId}&$active=true&$limit=20`);
  for (const e of open.data ?? []) {
    if (!e.finishedAt) await patch(page, `medical-encounters/${e.id}`, { finish: true }).catch(() => {});
  }
}

/** A NEW encounter (and its invoice) for the patient, after finishing any left open. */
export async function newEncounter(page: Page, facility: string, patientId: string) {
  await finishOpenEncounters(page, facility, patientId);
  const enc = await post(page, 'medical-encounters', {
    type: 'outpatient',
    patient: patientId,
    facility,
    invoice: true,
    visitReason: 'Consultation',
  });
  return {
    encounterId: String(enc.id),
    invoiceId: String(enc.invoice || enc.id),
    url: `/patients/${patientId}/encounters/${enc.id}`,
  };
}

export async function finishEncounter(page: Page, encounterId: string) {
  await patch(page, `medical-encounters/${encounterId}`, { finish: true });
}

/** The clinic's price-list row with this exact name (Settings › Services). */
export async function serviceByName(page: Page, facility: string, name: string) {
  const res = await get(page, `services?facility=${facility}&$limit=500`);
  const row = (res.data ?? []).find((s: any) => !s.archivedAt && String(s.name).trim() === name);
  expect(row, `the price list has "${name}"`).toBeTruthy();
  return { id: String(row.id), name: String(row.name), price: Number(row.price) };
}

export const invoiceOf = (page: Page, id: string) => get(page, `billing-invoices/${id}?$expand=items,payments`);
export const liveItems = async (page: Page, id: string) =>
  ((await invoiceOf(page, id)).items ?? []).filter((i: any) => !i.voidedAt);

/**
 * Shows the app as a doctor who doesn't take payments (display only: the
 * membership reads drop the owner and billing rights, the server still
 * decides). With it, the encounter's Charges opens the Charges sheet instead
 * of going straight to the Cashier.
 *
 * Copied from the app's `asMemberWithoutCollect` (e2e/batch40.fixtures.ts)
 * rather than imported, because that one also drops the owner's clinical
 * access, so the encounter behind the sheet would read "You don't have access
 * to this patient's clinical records". This copy keeps the record rights a
 * doctor has.
 */
export async function asDoctorWithoutCollect(page: Page) {
  const strip = (r: any) => {
    if (!r || typeof r !== 'object') return r;
    // A doctor still reads and writes clinical records; only the money rights go.
    const out = {
      ...r,
      superadmin: false,
      med_records: true,
      med_recordsRead: true,
      med_recordsCreate: true,
      med_recordsUpdate: true,
    };
    delete out.bl_invoices;
    delete out.bl_payments;
    if (Array.isArray(out.roles))
      out.roles = out.roles.filter((x: any) => x !== 'superadmin' && x?.id !== 'superadmin');
    return out;
  };
  await page.route('**/api/organization-members**', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    let body: any;
    try {
      body = await res.json();
    } catch {
      return route.fulfill({ response: res });
    }
    const next = Array.isArray(body?.data) ? { ...body, data: body.data.map(strip) } : strip(body);
    await route.fulfill({ response: res, json: next });
  });
}

/** Lets an app toast go before the next picture (it would cover the footer). */
export async function waitToastGone(page: Page, text: string | RegExp) {
  const t = page.locator('[data-sonner-toast]').filter({ hasText: text });
  await expect(t).toHaveCount(0, { timeout: 15_000 }).catch(async () => {
    await page.locator('[data-sonner-toast] [data-close-button]').first().click().catch(() => {});
  });
}

/**
 * Voids the patient's unpaid invoices left by earlier runs (all but `keep`), so
 * the Cashier lists show this run's bills only. A voided invoice lists nowhere.
 */
export async function voidLeftovers(page: Page, facility: string, patientId: string, keep: string[] = []) {
  const res = await get(page, `billing-invoices?facility=${facility}&subject=${patientId}&$expand=items&$limit=50`);
  for (const inv of res.data ?? []) {
    if (inv.subject !== patientId || inv.finalizedAt || keep.includes(String(inv.id))) continue;
    const items = (inv.items ?? []).filter((i: any) => !i.voidedAt && !i.returnedAt).map((i: any) => i.id);
    if (!items.length) continue;
    await post(page, 'billing/void-transactions', { invoice: inv.id, items, reason: 'Guide re-run' }).catch(() => {});
  }
}

/**
 * Like helpers.ts `shot` with `el`, but cropped from a page capture. Under
 * WebKit an element capture of a sheet can wait forever for the element to
 * "settle" (its open transition reports it as moving), so the sheet's box is
 * cut out of the viewport picture instead.
 */
export async function shotBox(page: Page, pageSlug: string, name: string, el: Locator) {
  await settle(page);
  await page.waitForTimeout(400);
  const box = await el.boundingBox();
  expect(box, `${name}: the element is on screen`).toBeTruthy();
  const vp = page.viewportSize()!;
  const x = Math.max(0, Math.floor(box!.x));
  const y = Math.max(0, Math.floor(box!.y));
  const clip = {
    x,
    y,
    width: Math.min(vp.width - x, Math.ceil(box!.width)),
    height: Math.min(vp.height - y, Math.ceil(box!.height)),
  };
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide', clip });
  const file = resolve(ASSETS, pageSlug, `${name}.webp`);
  mkdirSync(dirname(file), { recursive: true });
  await sharp(png).webp({ quality: 82 }).toFile(file);
}
