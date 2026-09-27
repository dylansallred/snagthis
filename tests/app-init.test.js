const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright');

test('desktop initialization preserves newer ready credentials and updates, and ignores disposed requests and events', { timeout: 15000 }, async (t) => {
  const bundle = await build({
    stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { useAppInit } from '@/hooks/useAppInit';
      const pending = [];
      const infoListeners = [];
      const updaterListeners = [];
      let stoppedInfo = 0, stoppedUpdater = 0;
      const starting = { apiStartupState: 'starting', apiBaseUrl: 'http://127.0.0.1:1', apiAuthToken: '' };
      window.desktop = {
        getAppInfo: async () => ({ ...starting }),
        getSettings: () => new Promise(resolve => pending.push(resolve)),
        getUpdaterState: async () => ({ phase: 'idle', progress: 0 }),
        onAppInfoUpdate: callback => { infoListeners.push(callback); return () => { stoppedInfo += 1; }; },
        onUpdaterEvent: callback => { updaterListeners.push(callback); return () => { stoppedUpdater += 1; }; }
      };
      let current, refresh;
      function Harness({ gallery = false }) { current = useAppInit(gallery); return null; }
      const root = createRoot(document.getElementById('root'));
      flushSync(() => root.render(<Harness />));
      const settle = () => new Promise(resolve => setTimeout(resolve, 0));
      window.fixture = {
        ready() { flushSync(() => infoListeners[0]({ ...starting, apiStartupState: 'ready', apiAuthToken: 'isolated-fixture' })); },
        updateReady() { flushSync(() => updaterListeners[0]({ phase: 'downloaded', progress: 100 })); },
        async finishInitial() { pending[0]({ outputDirectory: '/fixture/downloads' }); await settle(); await settle(); },
        async disposePending() {
          refresh = current.initialize();
          flushSync(() => root.render(<Harness gallery />));
          // Even an event already queued before unsubscription must be ignored.
          flushSync(() => {
            infoListeners[0]({ ...starting, apiStartupState: 'failed' });
            updaterListeners[0]({ phase: 'error', progress: 0 });
          });
          pending[1]({ outputDirectory: '/stale/downloads' });
          await refresh; await settle();
        },
        snapshot() { return { state: current.appInfo?.apiStartupState, token: current.appInfo?.apiAuthToken,
          outputDirectory: current.settings.outputDirectory, updaterPhase: current.updater.phase, stoppedInfo, stoppedUpdater }; },
        close() { flushSync(() => root.unmount()); }
      };
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': path.resolve(__dirname, '../apps/desktop/src') },
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => window.fixture.ready());
  await page.evaluate(() => window.fixture.updateReady());
  await page.evaluate(() => window.fixture.finishInitial());
  const initialized = await page.evaluate(() => window.fixture.snapshot());
  assert.equal(initialized.state, 'ready', 'a stale initial starting snapshot must not overwrite the ready event');
  assert.equal(initialized.token, 'isolated-fixture', 'keep the credentials supplied by the ready event');
  assert.equal(initialized.outputDirectory, '/fixture/downloads', 'initial preferences must still load');
  assert.equal(initialized.updaterPhase, 'downloaded', 'a stale initial idle snapshot must not hide a downloaded update');
  await page.evaluate(() => window.fixture.disposePending());
  const disposed = await page.evaluate(() => window.fixture.snapshot());
  assert.equal(disposed.state, 'ready');
  assert.equal(disposed.token, 'isolated-fixture');
  assert.equal(disposed.outputDirectory, '/fixture/downloads', 'disposed initialization must not change current settings');
  assert.equal(disposed.updaterPhase, 'downloaded', 'disposed subscriptions must not apply queued events');
  assert.equal(disposed.stoppedInfo, 1);
  assert.equal(disposed.stoppedUpdater, 1);
  await page.evaluate(() => window.fixture.close());
});
