import { defineConfig } from "@playwright/test";

// Headless unless a run opts in with E2E_HEADED=1 (see `npm run test:e2e:headed`).
const headed = process.env.E2E_HEADED === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 20_000,
  expect: { timeout: 5_000 },
  use: {
    headless: !headed,
    browserName: "chromium",
  },
});
