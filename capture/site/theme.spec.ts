import { test, expect, type Page } from '@playwright/test';

// The reader's device asks for dark, so a light page proves light is our default, not the device's.
test.use({ colorScheme: 'dark' });

const scheme = (page: Page) => page.locator('body').getAttribute('data-md-color-scheme');
const themeSwitch = (page: Page) => page.locator('.md-header form[data-md-component="palette"] label:visible');

test('opens in light mode, even when the device prefers dark', async ({ page }) => {
  await page.goto('./');
  expect(await scheme(page)).toBe('default');
});

test('the switch in the top bar changes between light and dark', async ({ page }) => {
  await page.goto('./');
  await expect(themeSwitch(page)).toHaveCount(1);

  await themeSwitch(page).click();
  expect(await scheme(page)).toBe('slate');

  await themeSwitch(page).click();
  expect(await scheme(page)).toBe('default');
});

test('the chosen mode stays after a refresh and on other pages', async ({ page }) => {
  await page.goto('./');
  await themeSwitch(page).click();
  expect(await scheme(page)).toBe('slate');

  await page.reload();
  expect(await scheme(page)).toBe('slate');

  // Another page of this guide: the first page link in the menu, so the check works in every app's guide.
  const other = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>('.md-sidebar--primary a.md-nav__link[href]')]
      .map(a => a.href)
      .find(href => href.split('#')[0] !== location.href.split('#')[0]),
  );
  await page.goto(other!);
  expect(await page.title()).not.toMatch(/404/);
  expect(await scheme(page)).toBe('slate');
});

// The switch used to have three options (follow the device, light, dark) and the theme saves the
// chosen option's position. With two options now, an old position would open the wrong mode.
const oldChoices = {
  'follow the device': { index: 0, color: { media: '(prefers-color-scheme)', scheme: 'slate', primary: 'custom', accent: 'custom' } },
  light: { index: 1, color: { media: '(prefers-color-scheme: light)', scheme: 'default', primary: 'custom', accent: 'custom' } },
  dark: { index: 2, color: { media: '(prefers-color-scheme: dark)', scheme: 'slate', primary: 'custom', accent: 'custom' } },
};

for (const [name, saved] of Object.entries(oldChoices)) {
  test(`a choice saved by the old three-way switch (${name}) is dropped, so it opens in light mode`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('./');
    const key = new URL(page.url()).pathname + '.__palette';
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(saved)]);

    await page.reload();
    expect(await scheme(page)).toBe('default');
    expect(errors).toEqual([]);

    // After that, the reader's new choice is kept as usual.
    await themeSwitch(page).click();
    await page.reload();
    expect(await scheme(page)).toBe('slate');
  });
}

test('clearing the site data brings back light mode', async ({ page }) => {
  await page.goto('./');
  await themeSwitch(page).click();
  expect(await scheme(page)).toBe('slate');

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  expect(await scheme(page)).toBe('default');
});
