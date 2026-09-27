const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const extension = path.resolve(__dirname, '../../apps/extension');

test('production popup boots without demo code and directs an old extension to the correct update flow', async ({ browser }) => {
  for (const fromStore of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 480, height: 650 }, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.abort());
      const html = fs.readFileSync(path.join(extension, 'popup.html'), 'utf8');
      await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, ''));
      await page.addStyleTag({ content: fs.readFileSync(path.join(extension, 'popup.css'), 'utf8') });
      await page.evaluate(fromStore => {
        window.updateFixture = { opened: [] };
        window.chrome = {
          runtime: { getManifest: () => ({ version: '1.0.0', ...(fromStore ? { update_url: 'https://clients2.google.com/service/update2/crx' } : {}) }),
            sendMessage: async () => ({ ok: true, visit: 'fixture', items: [], mappings: {} }) },
          tabs: { query: async () => [{ id: 1, url: 'https://fixture.invalid/watch' }], sendMessage: async () => ({ ok: true }),
            create: async value => { updateFixture.opened.push(value.url); } },
          storage: { local: { get: async () => ({ appToken: 'isolated-fixture', preferences: {} }), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {} } },
        };
        window.fetch = async url => new Response(JSON.stringify(new URL(url).pathname === '/v1/health'
          ? { status: 'ok', supportedProtocolVersions: { min: 1, max: 1 }, minExtensionVersion: '1.1.0' }
          : { settings: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }, fromStore);
      for (const match of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
        if (match[1] === 'popup/demo.js') continue; // The release ZIP omits development-only code.
        await page.addScriptTag({ content: fs.readFileSync(path.join(extension, match[1]), 'utf8') });
      }
      await expect(page.locator('#video-list')).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('#connection-banner')).toContainText('Update the Chrome extension to use desktop downloads.');
      await page.getByRole('button', { name: 'Update Chrome extension', exact: true }).click();
      await expect(page.locator('#sheet')).toBeVisible();
      await expect(page.locator('#sheet-content')).toContainText(fromStore ? 'Chrome Web Store' : 'same folder');
      await expect(page.getByRole('button', { name: 'Download extension ZIP', exact: true })).toHaveCount(fromStore ? 0 : 1);
      await page.getByRole('button', { name: 'Open Chrome extensions', exact: true }).click();
      expect(await page.evaluate(() => updateFixture.opened)).toEqual(['chrome://extensions/']);
      expect(await page.evaluate(() => typeof window.SnagThisDemo)).toBe('undefined');
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  }
});
