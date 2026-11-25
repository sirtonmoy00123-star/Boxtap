import { defineConfig, devices } from '@playwright/test';

// E2E runs against `wrangler dev` (Workers static assets, as in production) so _headers (CSP) really applies (audit B1).
const PORT = 8788;
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'off' },
  webServer: {
    command: `npx wrangler dev --port ${PORT} --ip 127.0.0.1`, // Workers static assets, same as production
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // Playwright's Windows WebKit build sometimes drops a tap under load (intermittent, not seen in Chromium);
    // one retry there only. Real Safari must still be checked on an iPhone.
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, retries: 1 },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
});
