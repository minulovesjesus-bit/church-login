import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.hoisted(() => vi.fn());
const serverCookieStore = vi.hoisted(() => ({
  current: undefined as
    | {
      setAll: (
        cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>,
        headers: Record<string, string>,
      ) => void;
    }
    | undefined,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async (cookieStore?: typeof serverCookieStore.current) => {
    serverCookieStore.current = cookieStore;
    return { auth: { exchangeCodeForSession } };
  },
}));

import { GET } from "./route";

beforeEach(() => {
  serverCookieStore.current = undefined;
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

it("returns the OAuth session cookie on the callback redirect", async () => {
  exchangeCodeForSession.mockImplementationOnce(async () => {
    serverCookieStore.current?.setAll(
      [
        {
          name: "sb-project-auth-token",
          value: "oauth-session",
          options: { httpOnly: true, path: "/", sameSite: "lax" },
        },
      ],
      {
        "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
        Expires: "0",
        Pragma: "no-cache",
      },
    );
    return { error: null };
  });

  const response = await GET(
    new NextRequest(
      "http://localhost:3000/auth/callback?code=pkce-code&next=/auth/continue",
    ),
  );

  expect(response.headers.get("set-cookie")).toContain(
    "sb-project-auth-token=oauth-session",
  );
});

it("converges a legacy destination on the role-aware continuation route", async () => {
  const response = await GET(
    new NextRequest(
      "https://church.example.test/auth/callback?code=pkce-code&next=/teacher/apply",
    ),
  );

  expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
  expect(response.headers.get("location")).toBe(
    "https://church.example.test/auth/continue",
  );
});

it("uses the browser host instead of the local server bind address", async () => {
  const response = await GET(
    new NextRequest(
      "http://0.0.0.0:3000/auth/callback?code=pkce-code&next=/auth/continue",
      { headers: { host: "localhost:3000" } },
    ),
  );

  expect(response.headers.get("location")).toBe(
    "http://localhost:3000/auth/continue",
  );
});

it("returns an OAuth exchange failure to unified login with its error", async () => {
  exchangeCodeForSession.mockResolvedValueOnce({ error: new Error("exchange failed") });

  const response = await GET(
    new NextRequest(
      "https://church.example.test/auth/callback?code=pkce-code&next=/student",
    ),
  );

  expect(response.headers.get("location")).toBe(
    "https://church.example.test/login?error=oauth_callback",
  );
});
