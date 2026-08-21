import { execFileSync } from "node:child_process";

import { defineConfig, devices } from "@playwright/test";

function localSupabaseEnvironment(): Record<string, string> {
  if (process.env.APP_ENV !== "test") {
    throw new Error("Identity browser fixtures require APP_ENV=test.");
  }

  const output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const values = Object.fromEntries(
    output
      .split("\n")
      .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[1], match[2]]),
  );
  const apiUrl = values.API_URL;
  const inbucketUrl = values.INBUCKET_URL;
  if (!apiUrl || !["127.0.0.1", "localhost"].includes(new URL(apiUrl).hostname)) {
    throw new Error("Identity browser fixtures require the local Supabase stack.");
  }
  if (!inbucketUrl || !["127.0.0.1", "localhost"].includes(new URL(inbucketUrl).hostname)) {
    throw new Error("Identity browser fixtures require the local Supabase mail viewer.");
  }
  if (!values.PUBLISHABLE_KEY || !values.SECRET_KEY || !values.DB_URL) {
    throw new Error("Local Supabase status did not return the required test credentials.");
  }

  return {
    APP_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: values.PUBLISHABLE_KEY,
    SUPABASE_URL: apiUrl,
    SUPABASE_PUBLISHABLE_KEY: values.PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: values.SECRET_KEY,
    INBUCKET_URL: inbucketUrl,
    DATABASE_URL: values.DB_URL,
    TEST_DATABASE_URL: values.DB_URL,
    INITIAL_ADMIN_EMAIL: "admin.identity@example.test",
    KIOSK_PASSWORD_HASH: "$argon2id$v=19$m=19456,t=2,p=1$aEMMH8W9GQEex53UG4nLww$fhTSmRVnGfJM6PUIY07nITrbEtIOPo46ZlRGSelIsTc",
    KIOSK_COOKIE_SECRET: "attendance-e2e-cookie-secret-2026-only-local",
    QR_SIGNING_SECRET: "attendance-e2e-qr-signing-secret-2026-local",
    KIOSK_INSECURE_LOCAL_COOKIES: "true",
    ALLOWED_FRONTEND_ORIGINS: "http://127.0.0.1:3216",
  };
}

const localEnvironment = localSupabaseEnvironment();
Object.assign(process.env, localEnvironment);

function applicationServerEnvironment(): Record<string, string> {
  const environment = { ...process.env, ...localEnvironment };
  delete environment.SUPABASE_SERVICE_ROLE_KEY;
  delete environment.TEST_DATABASE_URL;
  return environment;
}

const serverEnvironment = applicationServerEnvironment();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  globalSetup: "./tests/e2e/fixtures/global-setup.ts",
  globalTeardown: "./tests/e2e/fixtures/global-teardown.ts",
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3216",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3216",
      url: "http://127.0.0.1:3216",
      env: { ...serverEnvironment, FASTAPI_ORIGIN: "http://127.0.0.1:8216" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "uv run uvicorn api.index:app --host 127.0.0.1 --port 8216",
      url: "http://127.0.0.1:8216/api/health",
      env: serverEnvironment,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
