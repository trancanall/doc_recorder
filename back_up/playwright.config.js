const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  timeout: 0,
  use: {
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    screenshot: 'on',
    video: 'on',
    trace: 'on'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium'
      }
    }
  ]
});