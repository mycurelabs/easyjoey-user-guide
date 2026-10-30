import { expect, type Page } from '@playwright/test';
import { PASSWORD, dismissWhatsNew } from './helpers';

/**
 * Shows the iPad app's own screens in a browser: the lock screen, the Network
 * page, Backups and the offline notices only render inside the iPad app. This
 * stands in for the app's native bridge with an iPad that is already set up
 * for the demo clinic. Records still come from the demo account; only the
 * iPad's own facts (who uses it, its network, its backups) are made up here.
 * Nothing is sent anywhere; it is only used to picture the screens.
 */
export interface IpadOptions {
  /** The iPad has been offline past the 30-day limit (read-only). */
  offlineTooLong?: boolean;
  /** Show the "find devices on your local network" explanation. */
  localNetworkNotAsked?: boolean;
}

const MINUTE = 60_000;

export async function asSetUpIpad(page: Page, opts: IpadOptions = {}) {
  await page.addInitScript(
    ({ offlineTooLong, localNetworkNotAsked, minute }) => {
      const now = Date.now();
      const nowS = Math.floor(now / 1000);
      const clinic = 'guide-clinic';
      const iPad = (name: string, model: string) => ({
        name,
        platform: 'ios',
        model,
        model_id: 'iPad13,16',
        os_version: '18.1',
        app_version: '1.4.0 (212)',
      });
      const replies: Record<string, unknown> = {
        get_runtime_config: { mode: 'remote', api_url: '/api' },
        get_license_status: {
          state: 'valid',
          organization: clinic,
          // Past its signed expiry: the app turns read-only until the iPad reconnects.
          expiresAt: offlineTooLong ? nowS - 3600 : nowS + 20 * 86_400,
        },
        get_setup_state: { complete: true, organization: clinic },
        get_cadence_enrollment: { enrolled: true },
        get_authorization_status: {
          now: nowS,
          licenseState: 'valid',
          licenseAccess: offlineTooLong ? 'read_only' : 'full',
          licenseExpiresAt: offlineTooLong ? nowS - 3600 : nowS + 20 * 86_400,
          grantExpiresAt: nowS + 20 * 86_400,
          lastAttempt: offlineTooLong ? { at: nowS - 60, outcome: 'offline' } : null,
        },
        get_clinic_members: [
          { uid: 'm1', name: 'Dr. Ana Santos', email: 'dr.ana@dl.test', owner: true, roles: ['doctor'], canSignIn: true },
          { uid: 'm2', name: 'Mara Dizon', email: 'mara@ej.test', owner: false, roles: ['frontdesk'], canSignIn: true },
          { uid: 'm3', name: 'Dr. Rey Aquino', email: 'rey@ej.test', owner: false, roles: ['doctor'], canSignIn: false },
        ],
        get_local_discovery_health: localNetworkNotAsked
          ? { state: 'not_explained', explained: false, mdns: false, lan_peers_discovered: 0, direct_peers: 0 }
          : { state: 'found', explained: true, mdns: true, lan_peers_discovered: 1, direct_peers: 1 },
        get_cadence_sync_health: { verdict: 'synced', last_progress_ms: now - 2 * minute },
        backup_status: {
          entitled: true,
          running: false,
          lastSuccessAt: new Date(now - 5 * 60 * minute).toISOString(),
          lastAttemptAt: new Date(now - 5 * 60 * minute).toISOString(),
          lastError: null,
          lastSnapshotId: 'snap-1',
          lastSizeBytes: 48_300_000,
          lastCapturedAt: new Date(now - 5 * 60 * minute).toISOString(),
          restoredFrom: null,
        },
        get_network_overview: {
          running: true,
          this_device: { key: 'a1b2c3d4', ...iPad('Front desk iPad', 'iPad Air'), slot: 1 },
          peers: [
            {
              key: 'cloud0000',
              kind: 'cloud',
              live: true,
              path: { direct: true, relay: false, rtt_ms: 48 },
              last_sync_ms: now - 2 * minute,
              scopes: 6,
              in_sync: true,
              name: null,
              platform: null,
            },
            {
              key: 'e5f6a7b8',
              kind: 'local',
              live: true,
              path: { direct: true, relay: false, rtt_ms: 6 },
              last_sync_ms: now - 1 * minute,
              scopes: 6,
              in_sync: true,
              ...iPad("Doctor's iPad", 'iPad Pro 11-inch'),
              slot: 2,
            },
          ],
          known_devices: [
            { key: 'a1b2c3d4', last_seen_ms: now, ...iPad('Front desk iPad', 'iPad Air'), slot: 1 },
            { key: 'e5f6a7b8', last_seen_ms: now, ...iPad("Doctor's iPad", 'iPad Pro 11-inch'), slot: 2 },
          ],
          network: {
            // A real iPad reports its Wi-Fi addresses here; the guide shows names instead of IPs.
            interfaces: [{ name: 'en0', kind: 'wifi', address: 'Front desk iPad', subnet: 'Clinic Wi-Fi' }],
            primary: { name: 'en0', kind: 'wifi', address: 'Front desk iPad', subnet: 'Clinic Wi-Fi' },
            vpn: false,
            tailscale: false,
          },
          cloud: { reachable: true, located: true, relay_connected: true, seed_url: null, api_url: null },
          discovery: { state: 'found', explained: true, mdns: true, lan_peers_discovered: 1, direct_peers: 1, discovery: 'dns_sd' },
          sync: { verdict: 'synced', last_progress_ms: now - 2 * minute },
        },
        'plugin:event|listen': 1,
      };
      (window as any).isTauri = true;
      (window as any).__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
        transformCallback: () => 1,
        invoke: async (cmd: string) => (cmd in replies ? replies[cmd] : null),
      };
    },
    { offlineTooLong: !!opts.offlineTooLong, localNetworkNotAsked: !!opts.localNetworkNotAsked, minute: MINUTE },
  );
}

/**
 * Unlocks the iPad as the demo doctor: her name on the lock screen, then her
 * password. Written here because the app's e2e sign-in helpers only know the
 * web form (#email/#password); none drives the iPad's member list.
 */
export async function unlockIpad(page: Page) {
  if (!PASSWORD) throw new Error('Set GUIDE_PASSWORD for the demo account.');
  await page.goto('/login');
  await expect(page.getByTestId('lock-screen')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('member-m1').click();
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: /^Sign in$/ }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  await dismissWhatsNew(page);
}
