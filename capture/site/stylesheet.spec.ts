import { test, expect } from '@playwright/test';

// The stylesheet keeps its file name, and browsers may reuse a saved copy for a while after a deploy.
// Each build gives its address a new version, so readers get the new design straight after a deploy.
test('the guide stylesheet is linked once, with a version for this build', async ({ page }) => {
  await page.goto('./');
  const hrefs = await page.locator('link[rel="stylesheet"][href*="stylesheets/extra.css"]').evaluateAll(links =>
    links.map(l => l.getAttribute('href')),
  );
  expect(hrefs).toHaveLength(1);
  expect(hrefs[0]).toMatch(/stylesheets\/extra\.css\?v=\d{14}$/);

  // It still applies: the frosted header comes from this stylesheet.
  const header = await page.locator('.md-header').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(header).toBe('rgba(251, 251, 253, 0.8)');
});
