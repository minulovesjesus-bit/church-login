// @vitest-environment-options { "url": "http://0.0.0.0:3000/login" }

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const signInWithOAuth = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      signInWithPassword: vi.fn(),
      signInWithOAuth,
    },
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import StudentLoginPage from "./page";

beforeEach(() => {
  signInWithOAuth.mockReset();
  signInWithOAuth.mockResolvedValue({ error: null });
});

it("uses localhost for the OAuth callback when the dev server was opened at 0.0.0.0", async () => {
  render(<StudentLoginPage />);

  fireEvent.click(screen.getByRole("button", { name: "Google로 계속하기" }));

  await vi.waitFor(() => expect(signInWithOAuth).toHaveBeenCalledWith({
    provider: "google",
    options: {
      redirectTo: "http://localhost:3000/auth/callback?next=/auth/continue",
    },
  }));
});
