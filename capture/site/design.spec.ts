import { test, expect, type Browser, type Page } from '@playwright/test';

// Checks on the guide's design rules (see CHANGELOG.md). They read page links from the sidebar, so they
// work in every app's guide. DESIGN_PAGES adds more pages: comma-separated paths such as "help/words-and-answers/".
const extraPages = (process.env.DESIGN_PAGES || '').split(',').map(p => p.trim()).filter(Boolean);

const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };

async function newPage(browser: Browser, baseURL: string | undefined, viewport: { width: number; height: number }, touch = false) {
  const context = await browser.newContext({ baseURL, viewport, hasTouch: touch, isMobile: touch });
  return { context, page: await context.newPage() };
}

// The first `count` sidebar pages other than the home page.
async function sidebarPages(page: Page, count: number) {
  return page.evaluate(n => {
    const home = location.href.split('#')[0];
    const urls = [...document.querySelectorAll<HTMLAnchorElement>('.md-sidebar--primary a.md-nav__link[href]')]
      .map(a => a.href.split('#')[0])
      .filter(href => href !== home);
    return [...new Set(urls)].slice(0, n);
  }, count);
}

async function pagesToCheck(page: Page) {
  await page.goto('./');
  return ['./', ...(await sidebarPages(page, 2)), ...extraPages];
}

// Browser-side: is this element on screen? The slide-out menu is off-screen at narrow widths.
const isShown = `(el) => {
  const r = el.getClientRects()[0];
  if (!r || r.width === 0 || r.height === 0) return false;
  if (getComputedStyle(el).visibility === 'hidden') return false;
  return !(r.x < 0 || r.x > innerWidth);
}`;

// Browser-side: elements under `root` that set a size or weight off the type scale.
const typeScaleScript = (root: string) => `(() => {
  const shown = ${isShown};
  const out = [];
  for (const el of document.querySelector(${JSON.stringify(root)}).querySelectorAll('*')) {
    if (!shown(el)) continue;
    const hasOwnText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!hasOwnText) continue;
    const s = getComputedStyle(el);
    if (!['13px', '15px', '17px', '21px', '28px'].includes(s.fontSize) || !['400', '600'].includes(s.fontWeight)) {
      out.push(el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\\s+/).join('.') + ' "' + el.textContent.trim().slice(0, 30) + '" ' + s.fontSize + ' / ' + s.fontWeight);
    }
  }
  return out;
})()`;

test('uses only the type scale', async ({ browser, baseURL }) => {
  for (const [name, viewport, touch] of [['desktop', desktop, false], ['phone', phone, true]] as const) {
    const { context, page } = await newPage(browser, baseURL, viewport, touch);
    for (const path of await pagesToCheck(page)) {
      await page.goto(path);
      expect(await page.evaluate(typeScaleScript('body')), `${name} ${path}`).toEqual([]);
    }
    await context.close();
  }
});

test('top bar items share one height and centre line', async ({ browser, baseURL }) => {
  const { context, page } = await newPage(browser, baseURL, desktop);
  await page.goto('./');
  const selectors = {
    logo: '.md-header__button.md-logo img',
    name: '.md-header__topic',
    palette: '.md-header form[data-md-component="palette"] label:visible',
    search: '.md-search__form',
  };
  const boxes: Record<string, { height: number; centre: number }> = {};
  for (const [name, selector] of Object.entries(selectors)) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box, name).not.toBeNull();
    boxes[name] = { height: box!.height, centre: box!.y + box!.height / 2 };
  }
  for (const [name, box] of Object.entries(boxes)) {
    expect(Math.abs(box.height - 36), `${name} height ${box.height}`).toBeLessThanOrEqual(1);
    expect(Math.abs(box.centre - boxes.logo.centre), `${name} centre ${box.centre} vs logo ${boxes.logo.centre}`).toBeLessThanOrEqual(1);
  }
  await context.close();
});

// The bar's blur used to become the frame for the results, squashing them to the bar's height.
test('search opens full screen on a phone and shows results', async ({ browser, baseURL }) => {
  const { context, page } = await newPage(browser, baseURL, phone, true);
  await page.goto('./');
  const word = (await page.locator('h1').first().innerText()).trim().split(/\s+/)[0];

  await page.locator('.md-header label.md-header__button[for="__search"]').tap();
  // Typed key by key, as a reader does: filling the field in one go doesn't start the search.
  await page.locator('.md-search__input').pressSequentially(word);
  await page.locator('.md-search-result__item').first().waitFor();

  const output = await page.locator('.md-search__output').boundingBox();
  expect(output!.height).toBeGreaterThan(400);
  await context.close();
});

test('footer page names are never cut off', async ({ browser, baseURL }) => {
  const { context, page } = await newPage(browser, baseURL, phone, true);
  await page.goto('./');
  for (const url of await sidebarPages(page, 2)) {
    await page.goto(url);
    const cut = await page.locator('.md-footer .md-ellipsis').evaluateAll(els =>
      els.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => `"${el.textContent!.trim()}" ${el.scrollWidth} > ${el.clientWidth}`),
    );
    expect(cut, url).toEqual([]);
    // A hidden name has no width to overflow, so the check above would pass it.
    for (const title of await page.locator('.md-footer__title').all()) await expect(title, url).toBeVisible();
  }
  await context.close();
});

// Computed colours come as rgb()/rgba() or, for colour-mixed values, color(srgb r g b / a) with 0-1 channels.
// A translucent background (such as the tint behind a highlighted search word) is blended over the opaque one
// beneath it, so text is measured against the colour a reader sees.
const contrastScript = (root: string) => `(() => {
  const shown = ${isShown};
  const parse = (value) => {
    const nums = value.match(/-?[\\d.]+/g).map(Number);
    if (value.startsWith('color(')) return [nums[0] * 255, nums[1] * 255, nums[2] * 255, nums.length > 3 ? nums[3] : 1];
    return [nums[0], nums[1], nums[2], nums.length > 3 ? nums[3] : 1];
  };
  const over = (top, bottom) => [0, 1, 2].map(i => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1);
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const backgroundOf = (el) => {
    const layers = [];
    let base = [255, 255, 255, 1];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c[3] >= 1) { base = c; break; }
      if (c[3] > 0) layers.push(c);
    }
    return layers.reduceRight((bg, c) => over(c, bg), base);
  };
  const rootEl = document.querySelector(${JSON.stringify(root)});
  const out = [];
  for (const el of rootEl.querySelectorAll('*')) {
    // The top bar is see-through over the page, so its text has no single background (search results excepted).
    if ((rootEl === document.body && el.closest('.md-header')) || !shown(el)) continue;
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el);
    const bg = backgroundOf(el);
    const colour = over(parse(s.color), bg);
    const r = ratio(colour, bg);
    const need = parseFloat(s.fontSize) >= 24 ? 3 : 4.5;
    if (r < need) out.push(el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\\s+/).join('.') + ' "' + el.textContent.trim().slice(0, 30) + '" ' + r.toFixed(2) + ':1 (needs ' + need + ')');
  }
  return out;
})()`;

async function useDarkMode(page: Page) {
  await page.locator('.md-header form[data-md-component="palette"] label:visible').click();
  expect(await page.locator('body').getAttribute('data-md-color-scheme')).toBe('slate');
}

for (const mode of ['light', 'dark']) {
  test(`text has at least 4.5:1 contrast in ${mode} mode`, async ({ browser, baseURL }) => {
    const { context, page } = await newPage(browser, baseURL, desktop);
    await page.goto('./');
    const pages = ['./', ...(await sidebarPages(page, 1))];
    if (mode === 'dark') await useDarkMode(page);
    for (const path of pages) {
      await page.goto(path);
      // Scrolled down once, so the contents list on the right has its "you are here" marker.
      const lowerHeading = page.locator('.md-content h2').last();
      if (await lowerHeading.count()) {
        await lowerHeading.scrollIntoViewIfNeeded();
        await page.locator('.md-sidebar--secondary .md-nav__link--active').first().waitFor({ state: 'attached' });
      }
      expect(await page.evaluate(contrastScript('body')), `${mode} ${path}`).toEqual([]);
    }
    await context.close();
  });
}

// Search excerpts from tables and definition lists arrive as bare text with the matched words as direct
// children, not wrapped in a paragraph. The query is a word from the first such cell in the guide, so the
// check works in every app's guide.
async function tableWord(page: Page) {
  await page.goto('./');
  const paths = [...(await sidebarPages(page, 1000)), ...extraPages];
  // Pages are fetched and read in the browser, rather than opened one by one, to stay inside the test's time.
  const word = await page.evaluate(async urls => {
    for (const url of urls) {
      const html = await (await fetch(new URL(url, location.href))).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const cell = doc.querySelector('.md-content :is(td, dd)')?.textContent ?? '';
      const words = cell.match(/[A-Za-z]{5,}/g);
      if (words) return words.sort((a, b) => b.length - a.length)[0];
    }
    return null;
  }, paths);
  expect(word, 'a table or definition list in the guide to search for').not.toBeNull();
  return word!;
}

for (const mode of ['light', 'dark']) {
  test(`search excerpts keep the type scale, inline highlights and 4.5:1 contrast in ${mode} mode`, async ({ browser, baseURL }) => {
    const { context, page } = await newPage(browser, baseURL, desktop);
    const word = await tableWord(page);
    await page.goto('./');
    if (mode === 'dark') await useDarkMode(page);

    await page.locator('.md-search__input').click();
    await page.locator('.md-search__input').pressSequentially(word);
    await page.locator('.md-search-result__item').first().waitFor();
    // Results for the first letters can still be replaced; wait until the list stops changing.
    await page.waitForFunction(() => {
      const w = window as unknown as { lastResults?: string };
      const html = document.querySelector('.md-search-result__list')!.innerHTML;
      const settled = html === w.lastResults;
      w.lastResults = html;
      return settled;
    }, null, { polling: 300 });
    // Open every "N more on this page", so all excerpts are on screen.
    for (const more of await page.locator('.md-search-result__more > summary').all()) await more.click();

    const marks = page.locator('.md-search-result__article > mark');
    expect(await marks.count(), `"${word}" finds no table or definition-list excerpt`).toBeGreaterThan(0);
    const blockMarks = await marks.evaluateAll(els =>
      els.map(el => getComputedStyle(el).display).filter(d => d !== 'inline'),
    );
    // Soft, so a failing run lists every problem at once.
    expect.soft(blockMarks, `highlighted "${word}" displayed as`).toEqual([]);
    expect.soft(await page.evaluate(typeScaleScript('.md-search__output')), `type scale, search "${word}"`).toEqual([]);
    expect.soft(await page.evaluate(contrastScript('.md-search__output')), `${mode} contrast, search "${word}"`).toEqual([]);
    await context.close();
  });
}
