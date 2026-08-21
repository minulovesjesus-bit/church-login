import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const signInWithPassword = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({ auth: { signInWithPassword, signInWithOAuth: vi.fn() } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import StudentLoginPage from "./page";

it("sends a successful student login to the guarded student route", async () => {
  signInWithPassword.mockResolvedValue({ error: null });
  render(<StudentLoginPage />);

  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "student@example.com" } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "correct-password" } });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));

  await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/student"));
});
