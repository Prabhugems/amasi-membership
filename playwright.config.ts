import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  expect: {
    timeout: 10000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
      threshold: 0.3,
    },
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["html", { open: "always" }], ["list"]],
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: "on",
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "Desktop",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /.*\.setup\.ts/,
      dependencies: ["setup"],
    },
  ],
})
