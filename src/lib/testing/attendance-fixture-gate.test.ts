import { describe, expect, it } from "vitest";

import { attendanceFixtureEnabled } from "./attendance-fixture-gate";

const localEnvironment = {
  APP_ENV: "test",
  SUPABASE_URL: "http://127.0.0.1:54321",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  FASTAPI_ORIGIN: "http://127.0.0.1:8216",
};

it("enables deterministic QR injection only for the complete loopback test stack", () => {
  expect(attendanceFixtureEnabled(localEnvironment)).toBe(true);
});

describe.each([
  ["production mode", { APP_ENV: "production" }],
  ["hosted Supabase", { SUPABASE_URL: "https://project.supabase.co" }],
  ["remote database", { DATABASE_URL: "postgresql://user:pass@db.example.com/postgres" }],
  ["remote FastAPI", { FASTAPI_ORIGIN: "https://api.example.com" }],
  ["Vercel", { VERCEL: "1" }],
  ["Vercel environment", { VERCEL_ENV: "preview" }],
] as const)("rejects %s", (_label, override) => {
  it("does not expose the browser fixture bridge", () => {
    expect(attendanceFixtureEnabled({ ...localEnvironment, ...override })).toBe(false);
  });
});
