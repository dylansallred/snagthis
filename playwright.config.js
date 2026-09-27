// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  workers: '50%',
  // CI runners are slower and noisier than a laptop. One retry turns a timing flake into a
  // reported "flaky" result instead of a failed run (and a second full run of minutes), and the
  // retry records a trace so the cause can be found.
  retries: process.env.CI ? 1 : 0,
  use: { trace: 'on-first-retry' },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/e2e-junit.xml' }],
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
