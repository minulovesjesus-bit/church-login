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
  ["empty Vercel marker", { VERCEL: "" }],
  ["Vercel environment", { VERCEL_ENV: "preview" }],
  ["empty Vercel environment marker", { VERCEL_ENV: "" }],
] as const)("rejects %s", (_label, override) => {
  it("does not expose the browser fixture bridge", () => {
    expect(attendanceFixtureEnabled({ ...localEnvironment, ...override })).toBe(false);
  });
});

describe.each([
  ["query host", "postgresql://postgres:postgres@127.0.0.1:54322/postgres?host=db.example.com"],
  ["loopback query host", "postgresql://postgres:postgres@127.0.0.1:54322/postgres?host=127.0.0.1"],
  ["query hostaddr", "postgresql://postgres:postgres@127.0.0.1:54322/postgres?hostaddr=203.0.113.10"],
  ["query service", "postgresql://postgres:postgres@127.0.0.1:54322/postgres?service=remote"],
  ["query servicefile", "postgresql://postgres:postgres@127.0.0.1:54322/postgres?servicefile=%2Ftmp%2Fremote.conf"],
  ["mixed-case override", "postgresql://postgres:postgres@127.0.0.1:54322/postgres?HoSt=db.example.com"],
  ["encoded override name", "postgresql://postgres:postgres@127.0.0.1:54322/postgres?%68ost=db.example.com"],
  ["duplicate override", "postgresql://postgres:postgres@127.0.0.1:54322/postgres?host=127.0.0.1&host=db.example.com"],
] as const)("rejects a libpq %s", (_label, databaseUrl) => {
  it("does not trust the loopback URL authority", () => {
    expect(attendanceFixtureEnabled({
      ...localEnvironment,
      DATABASE_URL: databaseUrl,
    })).toBe(false);
  });
});

describe.each(["PGHOST", "PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE"] as const)(
  "rejects ambient %s",
  (name) => {
    it("does not expose the browser fixture bridge", () => {
      expect(attendanceFixtureEnabled({
        ...localEnvironment,
        [name]: "remote-destination",
      })).toBe(false);
    });
  },
);
