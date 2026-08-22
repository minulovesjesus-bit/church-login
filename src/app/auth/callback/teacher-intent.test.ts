import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createTeacherOAuthIntent } from "@/lib/auth/teacher-oauth-intent";

const exchangeCodeForSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { exchangeCodeForSession },
  }),
}));

import { GET } from "./route";

const secret = "teacher-oauth-test-secret-at-least-32-bytes";
const originalSecret = process.env.TEACHER_OAUTH_INTENT_SECRET;

beforeEach(() => {
  process.env.TEACHER_OAUTH_INTENT_SECRET = secret;
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.TEACHER_OAUTH_INTENT_SECRET;
  } else {
    process.env.TEACHER_OAUTH_INTENT_SECRET = originalSecret;
  }
  exchangeCodeForSession.mockReset();
});

function callbackRequest(intent: string, includeCookie = true): NextRequest {
  const url = new URL("https://church.example.test/auth/callback");
  url.searchParams.set("code", "one-time-pkce-code");
  url.searchParams.set("teacher_intent", intent);
  return new NextRequest(url, {
    headers: includeCookie
      ? { cookie: `teacher_oauth_intent=${intent}` }
      : undefined,
  });
}

function callbackRequestWithoutCode(intent: string): NextRequest {
  const url = new URL("https://church.example.test/auth/callback");
  url.searchParams.set("teacher_intent", intent);
  return new NextRequest(url, {
    headers: { cookie: `teacher_oauth_intent=${intent}` },
  });
}

it("consumes a valid browser-bound teacher intent after the PKCE exchange", async () => {
  const intent = createTeacherOAuthIntent(secret);

  const response = await GET(callbackRequest(intent));

  expect(exchangeCodeForSession).toHaveBeenCalledWith("one-time-pkce-code");
  expect(response.headers.get("location")).toBe(
    "https://church.example.test/teacher",
  );
  const cookie = response.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("teacher_oauth_intent=");
  expect(cookie).toContain("Max-Age=0");
});

it("falls back safely when a signed intent is replayed without its consumed cookie", async () => {
  const intent = createTeacherOAuthIntent(secret);

  const response = await GET(callbackRequest(intent, false));

  expect(response.headers.get("location")).toBe(
    "https://church.example.test/onboarding",
  );
});

it("falls back safely when a teacher intent is invalid or expired", async () => {
  const expired = createTeacherOAuthIntent(secret, {
    nowSeconds: 1,
    nonce: "expired-test-nonce",
  });

  const invalidResponse = await GET(callbackRequest(`${expired}tampered`));
  const expiredResponse = await GET(callbackRequest(expired));

  expect(invalidResponse.headers.get("location")).toBe(
    "https://church.example.test/onboarding",
  );
  expect(expiredResponse.headers.get("location")).toBe(
    "https://church.example.test/onboarding",
  );
});

it("returns a validated teacher flow to teacher login when the code is missing", async () => {
  const intent = createTeacherOAuthIntent(secret);

  const response = await GET(callbackRequestWithoutCode(intent));

  expect(response.headers.get("location")).toBe(
    "https://church.example.test/teacher/login?error=oauth_callback",
  );
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(exchangeCodeForSession).not.toHaveBeenCalled();
});

it("returns a validated teacher flow to teacher login when exchange fails", async () => {
  const intent = createTeacherOAuthIntent(secret);
  exchangeCodeForSession.mockResolvedValueOnce({ error: new Error("exchange failed") });

  const response = await GET(callbackRequest(intent));

  expect(response.headers.get("location")).toBe(
    "https://church.example.test/teacher/login?error=oauth_callback",
  );
  expect(response.headers.get("set-cookie")).toBeNull();
});
