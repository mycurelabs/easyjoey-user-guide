import { expect, type Page } from '@playwright/test';

import { appE2e } from './app-e2e';

/**
 * Shared by the "Seeing a patient" captures (05–08): API calls through the
 * app's own /api proxy as the signed-in demo doctor, a made-up patient with a
 * NEW open encounter, and a made-up image for upload steps.
 *
 * The /api calls and the Settings opener are the app's own e2e helpers
 * (patient-page.fixtures.ts, batch40.fixtures.ts). The app's patient and
 * encounter makers (encounter-paper.fixtures.ts) are not used: they are
 * private there and make a new, time-stamped patient every run, while the
 * guide re-uses its named demo patients.
 */
type Fx = {
  api(page: Page, path: string): Promise<any>;
  post(page: Page, path: string, data?: Record<string, unknown>): Promise<any>;
  patch(page: Page, path: string, data?: Record<string, unknown>): Promise<any>;
};
const fixtures = () => appE2e<Fx>('patient-page.fixtures.ts');

export async function api(page: Page, method: 'get' | 'post' | 'patch', path: string, data?: Record<string, unknown>) {
  const fx = await fixtures();
  if (method === 'get') return fx.api(page, path);
  return method === 'post' ? fx.post(page, path, data) : fx.patch(page, path, data);
}

/** Settings at one section, through the account menu (the app's batch40.fixtures.ts). */
export async function openSettingsAt(page: Page, section: string) {
  const fx = await appE2e<{ openSettingsAt(page: Page, section: string): Promise<void> }>('batch40.fixtures.ts');
  await fx.openSettingsAt(page, section);
}

export async function facilityOf(page: Page): Promise<string> {
  const s = await api(page, 'get', 'auth/get-session');
  const id = s?.session?.activeOrganizationId;
  expect(id, 'an active clinic').toBeTruthy();
  return id;
}

/** The signed-in doctor's user id (EasyJoey makes them the encounter's doctor). */
export async function myUid(page: Page): Promise<string | undefined> {
  const s = await api(page, 'get', 'auth/get-session');
  return s?.user?.id;
}

export interface Person {
  firstName: string;
  lastName: string;
  sex: 'male' | 'female';
  dateOfBirth: string;
  mobileNo: string;
}

/** A timestamp as ms, whether the server sent a number or an ISO date. */
const toMs = (v: unknown) => (typeof v === 'number' ? v : Date.parse(String(v ?? '')) || 0);

/**
 * A made-up patient, re-used across runs by name (made on the first run).
 * With `fresh`, earlier copies are archived and a new one is made.
 */
export async function findOrCreatePatient(page: Page, who: Person, opts: { fresh?: boolean } = {}) {
  const facility = await facilityOf(page);
  const found = await api(
    page,
    'get',
    `personal-details?type=medical-patients&facility=${facility}&name.lastName=${encodeURIComponent(who.lastName)}&name.firstName=${encodeURIComponent(who.firstName)}&$limit=20`,
  );
  // Trust the match only if the name really is ours (an ignored filter would return anyone).
  // A personal-details row doesn't say whether the patient is archived, and the list
  // filters don't leave archived ones out, so each match's medical-patients row is read:
  // it carries `archivedAt` once archived. The oldest copy still in use wins.
  // The date of birth must match too: the demo clinic has other patients with the
  // same names (an adult "Bea Garcia" among them), and `fresh` must never archive them.
  const day = (v: unknown) =>
    typeof v === 'number' ? new Date(v + 8 * 3_600_000).toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);
  const ours = (p: any) =>
    p?.name?.lastName === who.lastName &&
    p?.name?.firstName === who.firstName &&
    day(p?.dateOfBirth) === day(who.dateOfBirth);
  const live: { id: string; createdAt: number }[] = [];
  for (const p of (found?.data ?? []).filter(ours)) {
    const mp = await api(page, 'get', `medical-patients/${p.id}`).catch(() => null);
    if (mp && !mp.archivedAt) live.push({ id: String(p.id), createdAt: toMs(mp.createdAt ?? p.createdAt) });
  }
  live.sort((a, b) => a.createdAt - b.createdAt);
  let patientId: string | undefined = live[0]?.id;
  if (opts.fresh) {
    for (const p of live) await api(page, 'patch', `medical-patients/${p.id}`, { archive: true }).catch(() => {});
    patientId = undefined;
  }
  if (!patientId) {
    const patient = await api(page, 'post', 'medical-patients', {
      facility,
      personalDetails: {
        name: { firstName: who.firstName, lastName: who.lastName },
        sex: who.sex,
        dateOfBirth: who.dateOfBirth,
        mobileNo: who.mobileNo,
      },
    });
    patientId = String(patient.id);
  }
  return { facility, patientId: String(patientId) };
}

/**
 * A made-up patient (see findOrCreatePatient) plus a NEW open encounter. Any
 * encounter still open from an earlier run is ended first, so a new one can start.
 */
export async function patientWithEncounter(page: Page, who: Person, opts: { fresh?: boolean } = {}) {
  const { facility, patientId } = await findOrCreatePatient(page, who, opts);
  // Finish any encounter still open from an earlier run, so a new one can start.
  const open = await api(page, 'get', `medical-encounters?facility=${facility}&patient=${patientId}&$active=true&$limit=20`);
  for (const e of open?.data ?? []) await api(page, 'patch', `medical-encounters/${e.id}`, { finish: true }).catch(() => {});
  // The same body the app's Start encounter sends (EasyJoey composables/encounters.ts).
  const uid = await myUid(page);
  const encounter = await api(page, 'post', 'medical-encounters', {
    type: 'outpatient',
    patient: patientId,
    facility,
    invoice: true,
    ...(uid ? { doctors: [uid] } : {}),
  });
  return {
    facility,
    patientId,
    encounterId: String(encounter.id),
    url: `/patients/${patientId}/encounters/${encounter.id}`,
  };
}

/** A tiny made-up image (no real photo or X-ray) for upload steps. */
export async function syntheticImage(path: string, label: string) {
  const sharp = (await import('sharp')).default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
    <rect width="800" height="600" fill="#f3efe4"/>
    <rect x="60" y="60" width="680" height="480" rx="24" fill="#fff" stroke="#d8cfb8" stroke-width="4"/>
    <text x="400" y="290" font-family="Arial" font-size="40" text-anchor="middle" fill="#6b5a2e">${label}</text>
    <text x="400" y="350" font-family="Arial" font-size="24" text-anchor="middle" fill="#9a8a5e">Demo image</text>
  </svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toFile(path);
}

/** Waits for the app's pop-up messages to go, so they don't cover a capture. */
export async function noToasts(page: Page) {
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 }).catch(() => {});
}
