import { expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { appE2e } from './app-e2e';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/assets');

export const EMAIL = process.env.GUIDE_EMAIL || 'dr.ana@dl.test';
export const PASSWORD = process.env.GUIDE_PASSWORD || '';

/** Signs the demo account in with the app's own e2e sign-in, then puts away What's new. */
export async function signIn(page: Page, email = EMAIL, password = PASSWORD) {
  if (!password) throw new Error('Set GUIDE_PASSWORD for the demo account.');
  const { signIn: appSignIn } = await appE2e('patient-page.fixtures.ts');
  await appSignIn(page, email, password);
  await dismissWhatsNew(page);
}

/** A real sign-in opens What's new once; close it if it shows up. */
export async function dismissWhatsNew(page: Page) {
  const reader = page.getByTestId('whats-new');
  try {
    await reader.waitFor({ state: 'visible', timeout: 6_000 });
  } catch {
    return;
  }
  await page.getByTestId('whats-new-done').click();
  await expect(reader).toBeHidden();
}

/** Waits for network quiet, running animations and fonts, so a capture never catches a half-drawn screen. */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  // Loading placeholders (pulsing grey bars, busy regions) must be gone first;
  // WebKit fills them in noticeably later than Chromium. Give up after 15 s.
  await page
    .waitForFunction(
      () =>
        ![...document.querySelectorAll('.animate-pulse, [aria-busy="true"]')].some(
          el => (el as HTMLElement).offsetParent !== null,
        ),
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => {});
  // A route change can replace the document mid-wait; try again on the new one.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.evaluate(async () => {
        await document.fonts.ready;
        // Looping animations never finish; wait only for the ones that end, and never past 3 s.
        const ending = document
          .getAnimations()
          .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
          .map(a => a.finished.catch(() => {}));
        await Promise.race([Promise.all(ending), new Promise(r => setTimeout(r, 3_000))]);
      });
      break;
    } catch {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }
  }
  await page.waitForTimeout(400);
}

/**
 * Replaces on-screen text before a capture (display only, nothing is saved).
 * Used when a run needs a unique value, such as a throwaway sign-up email,
 * but the picture should show the tidy one the page describes.
 */
export async function showText(page: Page, from: RegExp, to: string) {
  await page.evaluate(
    ([source, flags, replacement]) => {
      const re = new RegExp(source, flags);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeValue && re.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(re, replacement);
      }
    },
    [from.source, from.flags, to] as const,
  );
}

export interface ShotOptions {
  /** Capture just this element (a sheet, menu or dialog) instead of the whole screen. */
  el?: Locator;
  /** Scroll this into view first. */
  at?: Locator;
}

/**
 * Writes docs/assets/<pageSlug>/<name>.webp. The capture is the app's viewport
 * only: no browser frame or address bar ever appears in an image. WebP keeps
 * the 2x (iPad sharp) images small enough for a repo and a phone connection.
 */
export async function shot(page: Page, pageSlug: string, name: string, opts: ShotOptions = {}) {
  const file = resolve(ASSETS, pageSlug, `${name}.webp`);
  mkdirSync(dirname(file), { recursive: true });
  if (opts.at) await opts.at.scrollIntoViewIfNeeded();
  await settle(page);
  const png = opts.el
    ? await opts.el.screenshot({ animations: 'disabled', caret: 'hide' })
    : await page.screenshot({ animations: 'disabled', caret: 'hide' });
  await sharp(png).webp({ quality: 82 }).toFile(file);
}
