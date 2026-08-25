import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const signInWithPassword = vi.hoisted(() => vi.fn());
const signInWithOAuth = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({ auth: { signInWithPassword, signInWithOAuth } }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import StudentLoginPage from "./page";

beforeEach(() => {
  signInWithPassword.mockReset();
  signInWithOAuth.mockReset();
  router.push.mockReset();
  window.history.replaceState({}, "", "/login");
});

it("explains an OAuth callback failure from the login query", async () => {
  window.history.replaceState({}, "", "/login?error=oauth_callback");

  render(<StudentLoginPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "로그인을 완료하지 못했습니다. 다시 시도해 주세요.",
  );
});

it("replaces the callback message with a new Google authentication error", async () => {
  window.history.replaceState({}, "", "/login?error=oauth_callback");
  signInWithOAuth.mockResolvedValue({ error: { message: "Google 인증을 시작하지 못했습니다." } });
  render(<StudentLoginPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("로그인을 완료하지 못했습니다.");
  fireEvent.click(screen.getByRole("button", { name: "Google로 계속하기" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Google 인증을 시작하지 못했습니다.");
  expect(screen.getByRole("alert")).not.toHaveTextContent("로그인을 완료하지 못했습니다.");
});

it("sends a successful password login to the role-aware continuation route", async () => {
  signInWithPassword.mockResolvedValue({ error: null });
  render(<StudentLoginPage />);

  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "student@example.com" } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "correct-password" } });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));

  await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/auth/continue"));
});

it("keeps a password authentication error readable without navigating", async () => {
  signInWithPassword.mockResolvedValue({ error: { message: "이메일 또는 비밀번호를 확인해 주세요." } });
  render(<StudentLoginPage />);

  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "student@example.com" } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "wrong-password" } });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("이메일 또는 비밀번호를 확인해 주세요.");
  expect(router.push).not.toHaveBeenCalled();
});

it("replaces a raw provider credential error with a Korean recovery message", async () => {
  signInWithPassword.mockResolvedValue({
    error: { code: "invalid_credentials", message: "Invalid login credentials" },
  });
  render(<StudentLoginPage />);

  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "student@example.com" } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "wrong-password" } });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("이메일 또는 비밀번호를 확인해 주세요.");
  expect(alert).not.toHaveTextContent("Invalid login credentials");
});

it("explains how one account receives teacher access", () => {
  render(<StudentLoginPage />);

  expect(screen.getByText("학생과 교사가 같은 계정으로 로그인합니다.")).toBeVisible();
  expect(screen.getByText(/관리자가 기존 계정에 교사 권한을 추가/)).toBeVisible();
});

it("keeps login fields associated and links back to signup", () => {
  render(<StudentLoginPage />);

  expect(screen.getByRole("main")).toHaveAttribute("aria-labelledby");
  expect(screen.getByLabelText("이메일")).toHaveAttribute("autocomplete", "email");
  expect(screen.getByLabelText("비밀번호")).toHaveAttribute("autocomplete", "current-password");
  expect(screen.getByRole("link", { name: "회원가입" })).toHaveAttribute("href", "/auth/signup");
});

it("presents signup as a full-width secondary action", () => {
  render(<StudentLoginPage />);

  const signup = screen.getByRole("link", { name: "회원가입" });
  expect(signup).toHaveClass("w-full");
  expect(signup).toHaveAttribute("data-variant", "outline");
});

it("identifies the Google action with the Google brand mark", () => {
  render(<StudentLoginPage />);

  const googleButton = screen.getByRole("button", { name: "Google로 계속하기" });
  expect(
    googleButton.querySelector('[data-brand-icon="google"]'),
  ).toBeInTheDocument();
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
  await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/auth/continue"));
});

it("sends Google authentication to the role-aware continuation route", async () => {
  signInWithOAuth.mockResolvedValue({ error: null });
  render(<StudentLoginPage />);

  fireEvent.click(screen.getByRole("button", { name: "Google로 계속하기" }));

  await vi.waitFor(() => expect(signInWithOAuth).toHaveBeenCalledWith({
    provider: "google",
    options: { redirectTo: "http://localhost:3000/auth/callback?next=/auth/continue" },
  }));
});
