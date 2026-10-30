import type { Page } from '@playwright/test';

/**
 * Shows the iPad app's first screens in a browser. "Set up this device" only
 * opens inside the iPad app, so this stands in for the app's native bridge
 * with a brand-new, not-yet-set-up device. Nothing is sent to a server; it is
 * only used to picture the screens.
 */
export interface NewIpadOptions {
  /**
   * Answer the setup sign-in with a made-up EasyJoey account and clinic (the
   * same kind of stand-in the app's own native-setup e2e uses), so "Sign in
   * and set up" walks on to the next real screens.
   */
  cloud?: boolean;
  /** The clinic has daily backups from another iPad: setup asks "Restore from a backup?". */
  backups?: boolean;
  /** The clinic's EasyJoey is not activated yet. */
  notActivated?: boolean;
  /** The sign-in is refused: "Incorrect email or password". */
  wrongPassword?: boolean;
  /**
   * Re-open the app part-way: the clinic has already downloaded, so only
   * "Sign in to finish" is left ('finish'), or the device is registered and
   * waiting for activation ('waiting').
   */
  resume?: 'finish' | 'waiting';
}

const CLINIC = 'guide-clinic';
const OWNER = 'guide-owner';

export async function asNewIpad(page: Page, opts: NewIpadOptions = {}) {
  await page.addInitScript(
    ({ opts, clinic, owner }) => {
      const resumed = !!opts.resume;
      const license =
        opts.notActivated || opts.resume === 'waiting' ? 'missing_entitlement' : 'valid';
      const done = opts.resume === 'finish';
      const replies: Record<string, unknown> = {
        get_runtime_config: { mode: 'remote', api_url: '/api' },
        get_license_status: resumed
          ? { state: license, organization: clinic }
          : { state: 'not_enrolled' },
        get_setup_state: resumed
          ? { complete: false, organization: clinic, ownerUid: owner }
          : { complete: false },
        get_authorization_status: null,
        get_cadence_enrollment: resumed
          ? { enrolled: true, running: true, grant: { valid: true } }
          : { enrolled: false },
        get_cloud_endpoints: { cloud_api_url: location.origin + '/guide-cloud' },
        license_enroll: { state: license, organization: clinic },
        cadence_enroll: { state: 'enrolled' },
        // Part-way through the download: the clinic, role and account are on the iPad.
        get_bootstrap_progress: {
          organization: true,
          membership: true,
          account: true,
          personalDetails: true,
          user: true,
          credential: done,
          license: done,
          complete: done,
        },
        'plugin:event|listen': 1,
      };
      (window as any).isTauri = true;
      (window as any).__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: 'main' },
          currentWebview: { label: 'main', windowLabel: 'main' },
        },
        transformCallback: () => 0,
        invoke: async (cmd: string) => (cmd in replies ? replies[cmd] : null),
      };
    },
    { opts, clinic: CLINIC, owner: OWNER },
  );

  if (!opts.cloud) return;
  const hour = 3_600_000;
  const now = Date.now();
  const snapshot = (id: string, hoursAgo: number, mb: number) => ({
    id,
    machineId: 'front-desk',
    deviceLabel: 'Front desk iPad',
    status: 'committed',
    capturedAt: new Date(now - hoursAgo * hour).toISOString(),
    sizeBytes: mb * 1024 * 1024,
  });
  await page.route('**/guide-cloud/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (opts.wrongPassword && path.endsWith('/auth/sign-in/email'))
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    const body = path.endsWith('/auth/sign-in/email')
      ? { token: 'guide-session', user: { id: OWNER, email: 'dr.ana@dl.test' } }
      : path.endsWith('/organization-members')
        ? { data: [{ organization: CLINIC }] }
        : path.endsWith('/licenses/licenses')
          ? { data: [{ id: 'guide-license', organization: CLINIC, product: 'easyjoey' }] }
          : path.endsWith('/backups/snapshots')
            ? { data: opts.backups ? [snapshot('b1', 14, 46), snapshot('b2', 38, 45)] : [] }
            : null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}
