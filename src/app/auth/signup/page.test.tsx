import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const signUp = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({ auth: { signUp } }),
}));

import StudentSignupPage from "./page";

beforeEach(() => {
  signUp.mockReset();
});

it("offers only the approved email and password signup action", () => {
  render(<StudentSignupPage />);

  expect(screen.getByRole("button", { name: "회원가입" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Google로 계속하기" })).not.toBeInTheDocument();
  expect(screen.queryByText("또는")).not.toBeInTheDocument();
});

it("preserves the signup payload, callback, and success status", async () => {
  signUp.mockResolvedValue({ error: null });
  render(<StudentSignupPage />);

  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "student@example.com" } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("button", { name: "회원가입" }));

  await vi.waitFor(() => expect(signUp).toHaveBeenCalledWith({
    email: "student@example.com",
    password: "password123",
    options: { emailRedirectTo: "http://localhost:3000/auth/callback?next=/auth/continue" },
  }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "인증 이메일을 확인한 뒤 계속해 주세요.",
  );
  expect(screen.getByRole("link", { name: "로그인으로 돌아가기" })).toHaveAttribute(
    "href",
    "/login",
  );
});

it("locks signup while the request is pending", async () => {
  let finish!: (value: { error: null }) => void;
  signUp.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<StudentSignupPage />);

  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "student@example.com" } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("button", { name: "회원가입" }));
  fireEvent.click(screen.getByRole("button", { name: "가입 중" }));

  expect(signUp).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "가입 중" })).toBeDisabled();

  finish({ error: null });
  expect(await screen.findByRole("status")).toBeVisible();
});

it("shows the password rule and unified account path before submission", () => {
  render(<StudentSignupPage />);

  expect(screen.getByRole("heading", { name: "회원가입" })).toBeInTheDocument();
  expect(screen.getByText("학생과 교사가 하나의 계정을 사용합니다.")).toBeVisible();
  expect(screen.getByText(/관리자가 기존 계정에 교사 권한을 추가/)).toBeVisible();
  expect(screen.getByText("비밀번호는 8자 이상 입력해 주세요.")).toBeVisible();
});

it("associates duplicate-email and weak-password errors with the relevant field in Korean", async () => {
  signUp
    .mockResolvedValueOnce({
      error: { code: "user_already_exists", message: "User already registered" },
    })
    .mockResolvedValueOnce({
      error: { code: "weak_password", message: "Password should be at least 8 characters" },
    });
  const view = render(<StudentSignupPage />);

  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "student@example.com" } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("button", { name: "회원가입" }));

  let alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("이미 가입된 이메일입니다. 로그인해 주세요.");
  expect(screen.getByLabelText("이메일")).toHaveAttribute("aria-describedby", alert.id);
  expect(screen.getByLabelText("비밀번호")).not.toHaveAttribute("aria-describedby", alert.id);

  view.unmount();
  render(<StudentSignupPage />);
  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "new@example.com" } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("button", { name: "회원가입" }));

  alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("비밀번호는 8자 이상 입력해 주세요.");
  expect(screen.getByLabelText("비밀번호")).toHaveAttribute("aria-describedby", alert.id);
  expect(screen.getByLabelText("이메일")).not.toHaveAttribute("aria-describedby", alert.id);
});
