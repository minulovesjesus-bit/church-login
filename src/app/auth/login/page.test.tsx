import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const signInWithPassword = vi.hoisted(() => vi.fn());
const signInWithOAuth = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({ auth: { signInWithPassword, signInWithOAuth } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import StudentLoginPage from "./page";

beforeEach(() => {
  signInWithPassword.mockReset();
  signInWithOAuth.mockReset();
  router.push.mockReset();
});

it("sends a successful student login to the guarded student route", async () => {
  signInWithPassword.mockResolvedValue({ error: null });
  render(<StudentLoginPage />);

  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "student@example.com" } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "correct-password" } });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));

  await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/student"));
});

it("keeps login fields associated and links back to signup", () => {
  render(<StudentLoginPage />);

  expect(screen.getByRole("main")).toHaveAttribute("aria-labelledby");
  expect(screen.getByLabelText("이메일")).toHaveAttribute("autocomplete", "email");
  expect(screen.getByLabelText("비밀번호")).toHaveAttribute("autocomplete", "current-password");
  expect(screen.getByRole("link", { name: "회원가입" })).toHaveAttribute("href", "/auth/signup");
});

it("locks both login actions while password authentication is pending", async () => {
  let finish!: (value: { error: null }) => void;
  signInWithPassword.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<StudentLoginPage />);

  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "student@example.com" } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "correct-password" } });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));
  fireEvent.click(screen.getByRole("button", { name: "로그인 중" }));

  expect(signInWithPassword).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "로그인 중" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Google로 계속하기" })).toBeDisabled();

  finish({ error: null });
  await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/student"));
});

it("preserves the student Google callback target", async () => {
  signInWithOAuth.mockResolvedValue({ error: null });
  render(<StudentLoginPage />);

  fireEvent.click(screen.getByRole("button", { name: "Google로 계속하기" }));

  await vi.waitFor(() => expect(signInWithOAuth).toHaveBeenCalledWith({
    provider: "google",
    options: { redirectTo: "http://localhost:3000/auth/callback?next=/student" },
  }));
});
