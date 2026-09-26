import { defineConfig, devices } from '@playwright/test';

/**
 * Real end-to-end tests over HTTP/UI (a browser), unlike the rest of the
 * suite which verifies flows at the library-function level (see
 * docs/fasi/F0-fondamenta.md "Stato"). Targets an already-running app —
 * `docker compose -f docker/docker-compose.yml up` — rather than spinning up
 * its own Postgres/Redis, since that's the one environment these flows are
 * meant to prove out end-to-end.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
