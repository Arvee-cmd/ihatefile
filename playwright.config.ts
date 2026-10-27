import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run the production build (vite preview) against the real FastAPI backend.
 *  IHATEFILE_PYTHON            python with backend/requirements.txt installed (default: python3)
 *  IHATEFILE_CHROMIUM_PATH     optional pre-installed Chromium executable
 */
const python = process.env.IHATEFILE_PYTHON ?? 'python3'
const chromium = process.env.IHATEFILE_CHROMIUM_PATH

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    acceptDownloads: true,
    launchOptions: chromium ? { executablePath: chromium } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `${python} -m uvicorn asgi:app --port 8000 --host 127.0.0.1`,
      cwd: 'backend',
      url: 'http://127.0.0.1:8000/api/v1/health',
      env: { IHATEFILE_RATE_LIMIT_PER_MINUTE: '500', IHATEFILE_CORS_ORIGINS: 'http://127.0.0.1:4173' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
})
