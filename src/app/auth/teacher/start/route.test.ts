import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const signInWithOAuth = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { signInWithOAuth } }),
}));

import { GET } from "./route";

const originalSecret = process.env.TEACHER_OAUTH_INTENT_SECRET;

beforeEach(() => {
  process.env.TEACHER_OAUTH_INTENT_SECRET =
    "teacher-oauth-test-secret-at-least-32-bytes";
  signInWithOAuth.mockResolvedValue({
    data: { url: "https://accounts.example.test/google-oauth" },
    error: null,
  });
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.TEACHER_OAUTH_INTENT_SECRET;
  } else {
    process.env.TEACHER_OAUTH_INTENT_SECRET = originalSecret;
  }
  signInWithOAuth.mockReset();
});

it("starts PKCE with a signed teacher intent and a hardened browser-bound cookie", async () => {
  const response = await GET(
    new NextRequest("https://church.example.test/auth/teacher/start"),
  );

  expect(response.headers.get("location")).toBe(
    "https://accounts.example.test/google-oauth",
  );
  const oauthOptions = signInWithOAuth.mock.calls[0][0];
  expect(oauthOptions.provider).toBe("google");
  expect(oauthOptions.options.skipBrowserRedirect).toBe(true);
  const redirectTo = new URL(oauthOptions.options.redirectTo);
  expect(redirectTo.pathname).toBe("/auth/callback");
  expect(redirectTo.searchParams.has("next")).toBe(false);
  expect(redirectTo.searchParams.get("teacher_intent")).toBeTruthy();

  const cookie = response.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("teacher_oauth_intent=");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=lax");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("Path=/auth");
  expect(cookie).toContain("Max-Age=300");
});

it("falls back without starting OAuth when the server secret is missing", async () => {
  delete process.env.TEACHER_OAUTH_INTENT_SECRET;

  const response = await GET(
    new NextRequest("https://church.example.test/auth/teacher/start"),
  );

  expect(response.headers.get("location")).toBe(
    "https://church.example.test/teacher/login?error=oauth_unavailable",
  );
  expect(signInWithOAuth).not.toHaveBeenCalled();
});
