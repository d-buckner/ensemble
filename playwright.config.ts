import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Ensemble integration tests
 * Tests demos to validate end-to-end functionality including worker threads
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',

  // Run tests in parallel
  fullyParallel: true,

  // Fail fast on CI
  forbidOnly: !!process.env.CI,

  // Retry on CI
  retries: process.env.CI ? 2 : 0,

  // Limit workers on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter configuration
  reporter: process.env.CI ? 'github' : 'list',

  // Shared settings for all projects
  use: {
    // Base URL will be overridden per project
    baseURL: 'http://localhost:5173',

    // Collect trace on first retry
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',
  },

  // Configure projects for different demos
  projects: [
    {
      name: 'counter-react',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3001',
      },
      testMatch: '**/counter-react.spec.ts',
    },
    {
      name: 'metrics-dashboard',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5174',
      },
      testMatch: '**/metrics-dashboard.spec.ts',
    },
  ],

  // Web server configuration - don't start servers (manual for now)
  // webServer will be added once we have a reliable way to start demos
});
