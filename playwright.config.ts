import { defineConfig, devices } from '@playwright/test';

// E2E runs against `wrangler pages dev dist` so Cloudflare's _headers (CSP) and _redirects really apply (audit B1).
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
    command: `npx wrangler pages dev dist --port ${PORT} --ip 127.0.0.1 --compatibility-date=2026-11-23`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
});
