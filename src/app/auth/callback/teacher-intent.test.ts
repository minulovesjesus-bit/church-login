import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { exchangeCodeForSession },
  }),
}));

import { GET } from "./route";

beforeEach(() => {
  exchangeCodeForSession.mockReset();
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

function callbackRequest(): NextRequest {
  const url = new URL("https://church.example.test/auth/callback");
  url.searchParams.set("code", "one-time-pkce-code");
  url.searchParams.set("teacher_intent", "retired-teacher-intent");
  return new NextRequest(url, {
    headers: { cookie: "teacher_oauth_intent=retired-teacher-intent" },
  });
}

function callbackRequestWithoutCode(): NextRequest {
  const url = new URL("https://church.example.test/auth/callback");
  url.searchParams.set("teacher_intent", "retired-teacher-intent");
  return new NextRequest(url, {
    headers: { cookie: "teacher_oauth_intent=retired-teacher-intent" },
  });
}

it("ignores retired teacher intent and continues after the PKCE exchange", async () => {
  const response = await GET(callbackRequest());

  expect(exchangeCodeForSession).toHaveBeenCalledWith("one-time-pkce-code");
  expect(response.headers.get("location")).toBe(
    "https://church.example.test/auth/continue",
  );
  expect(response.headers.get("set-cookie")).toBeNull();
});

it("returns a callback without a code to unified login with its error", async () => {
  const response = await GET(callbackRequestWithoutCode());

  expect(response.headers.get("location")).toBe(
    "https://church.example.test/login?error=oauth_callback",
  );
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(exchangeCodeForSession).not.toHaveBeenCalled();
});

it("returns a teacher-intent callback exchange failure to unified login", async () => {
  exchangeCodeForSession.mockResolvedValueOnce({ error: new Error("exchange failed") });

  const response = await GET(callbackRequest());

  expect(response.headers.get("location")).toBe(
    "https://church.example.test/login?error=oauth_callback",
  );
  expect(response.headers.get("set-cookie")).toBeNull();
});
