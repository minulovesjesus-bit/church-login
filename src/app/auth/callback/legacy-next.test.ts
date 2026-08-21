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
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

it("does not accept the legacy unsigned teacher next destination", async () => {
  const response = await GET(
    new NextRequest(
      "https://church.example.test/auth/callback?code=pkce-code&next=/teacher/apply",
    ),
  );

  expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
  expect(response.headers.get("location")).toBe(
    "https://church.example.test/onboarding",
  );
});
