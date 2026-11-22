// Stress / CPU-throttled QA harness for ../sound_alchemist.html
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 45 * 60 * 1000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    browserName: 'chromium',
    viewport: { width: 480, height: 1800 },
    deviceScaleFactor: 1,
    actionTimeout: 15000,
    video: { mode: 'on', size: { width: 480, height: 1800 } },
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
});
