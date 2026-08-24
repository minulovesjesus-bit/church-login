import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { mockApi, resetMockApi } from "@/test/mock-api";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const signOut = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => {
  class TestApiClientError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  return { ApiClientError: TestApiClientError };
});

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/api/client", () => ({ api: mockApi, ApiClientError: client.ApiClientError }));
vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({ auth: { signOut } }),
}));

import { StudentAccountCard } from "./student-account-card";

const profile = {
  name: "김민준",
  birth_date: "2012-04-03",
  phone: "01012345678",
  guardian_phone: "01098765432",
  include_in_statistics: true,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  resetMockApi();
  router.replace.mockReset();
  signOut.mockReset();
});

it("loads an independent account card and retries a temporary profile failure", async () => {
  mockApi.get
    .mockRejectedValueOnce(new client.ApiClientError("REQUEST_FAILED", "잠시 후 다시 시도해 주세요."))
    .mockResolvedValueOnce(profile);

  render(<StudentAccountCard email="student@example.com" />);

  expect(screen.getByRole("heading", { name: "내 정보" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("내 정보를 불러오고 있습니다.");
  expect(mockApi.get).toHaveBeenCalledWith(
    "/api/students/profile",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");

  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByText("김민준")).toBeVisible();
  expect(screen.getByText("student@example.com")).toBeVisible();
  expect(screen.getByText("2012-04-03")).toBeVisible();
  expect(mockApi.get).toHaveBeenCalledTimes(2);
});

it.each([
  ["AUTH_REQUIRED", "/login"],
  ["PROFILE_REQUIRED", "/onboarding"],
] as const)("redirects %s profile responses to %s", async (code, destination) => {
  mockApi.get.mockRejectedValue(new client.ApiClientError(code, "다시 로그인해 주세요."));
  render(<StudentAccountCard email="student@example.com" />);

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith(destination));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("prefills the real profile form, patches only the approved values, and refreshes the local card", async () => {
  const savedProfile = { ...profile, name: "김민지", phone: "01055556666" };
  mockApi.get.mockResolvedValue(profile);
  mockApi.patch.mockResolvedValue(savedProfile);
  render(<StudentAccountCard email="student@example.com" />);

  fireEvent.click(await screen.findByRole("button", { name: "개인정보 수정" }));
  const dialog = screen.getByRole("dialog", { name: "개인정보 수정" });
  expect(within(dialog).getByLabelText("이름")).toHaveValue("김민준");
  expect(within(dialog).getByLabelText("생년")).toHaveValue("2012");
  expect(within(dialog).getByLabelText("학생 연락처 중간자리")).toHaveValue("1234");

  fireEvent.change(within(dialog).getByLabelText("이름"), { target: { value: "김민지" } });
  fireEvent.change(within(dialog).getByLabelText("학생 연락처 중간자리"), { target: { value: "5555" } });
  fireEvent.change(within(dialog).getByLabelText("학생 연락처 끝자리"), { target: { value: "6666" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));

  await waitFor(() => expect(mockApi.patch).toHaveBeenCalledWith(
    "/api/students/profile",
    {
      name: "김민지",
      birth_date: "2012-04-03",
      phone: "01055556666",
      guardian_phone: "01098765432",
    },
  ));
  const body = mockApi.patch.mock.calls[0]?.[1] as Record<string, unknown>;
  expect(body).not.toHaveProperty("email");
  expect(body).not.toHaveProperty("include_in_statistics");
  expect(body).not.toHaveProperty("user_id");
  expect(body).not.toHaveProperty("roles");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByText("김민지")).toBeVisible();
  expect(screen.getByText("01055556666")).toBeVisible();
});

it.each([
  ["AUTH_REQUIRED", "/login"],
  ["PROFILE_REQUIRED", "/onboarding"],
] as const)("redirects %s profile-save responses to %s", async (code, destination) => {
  mockApi.get.mockResolvedValue(profile);
  mockApi.patch.mockRejectedValue(new client.ApiClientError(code, "세션을 다시 확인해 주세요."));
  render(<StudentAccountCard email="student@example.com" />);

  fireEvent.click(await screen.findByRole("button", { name: "개인정보 수정" }));
  const dialog = screen.getByRole("dialog", { name: "개인정보 수정" });
  fireEvent.change(within(dialog).getByLabelText("이름"), { target: { value: "김민지" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith(destination));
  expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps the edit dialog and entered values on failure while preventing duplicate saves", async () => {
  const save = deferred<typeof profile>();
  mockApi.get.mockResolvedValue(profile);
  mockApi.patch.mockReturnValue(save.promise);
  render(<StudentAccountCard email="student@example.com" />);

  fireEvent.click(await screen.findByRole("button", { name: "개인정보 수정" }));
  const dialog = screen.getByRole("dialog", { name: "개인정보 수정" });
  fireEvent.change(within(dialog).getByLabelText("이름"), { target: { value: "김민지" } });
  const submit = within(dialog).getByRole("button", { name: "저장" });
  fireEvent.click(submit);
  fireEvent.click(submit);

  expect(mockApi.patch).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole("button", { name: /저장 중/ })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "취소" })).toBeDisabled();

  await act(async () => save.reject(new client.ApiClientError("REQUEST_FAILED", "저장하지 못했습니다.")));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("저장하지 못했습니다.");
  expect(within(dialog).getByLabelText("이름")).toHaveValue("김민지");
  expect(screen.getByRole("dialog", { name: "개인정보 수정" })).toBeInTheDocument();
});

it("requires confirmation and signs out only the local browser session", async () => {
  mockApi.get.mockResolvedValue(profile);
  signOut.mockResolvedValue({ error: null });
  render(<StudentAccountCard email="student@example.com" />);

  fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));
  expect(signOut).not.toHaveBeenCalled();
  const dialog = screen.getByRole("alertdialog", { name: "로그아웃" });
  fireEvent.click(within(dialog).getByRole("button", { name: "로그아웃 확인" }));

  await waitFor(() => expect(signOut).toHaveBeenCalledWith({ scope: "local" }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
});

it("keeps logout confirmation actionable during a failed or pending request and prevents duplicate calls", async () => {
  const logout = deferred<{ error: { message: string } | null }>();
  mockApi.get.mockResolvedValue(profile);
  signOut.mockReturnValue(logout.promise);
  render(<StudentAccountCard email="student@example.com" />);

  fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));
  const dialog = screen.getByRole("alertdialog", { name: "로그아웃" });
  const confirm = within(dialog).getByRole("button", { name: "로그아웃 확인" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);

  expect(signOut).toHaveBeenCalledTimes(1);
  expect(within(dialog).getByRole("button", { name: /로그아웃 중/ })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "로그아웃 취소" })).toBeDisabled();
  expect(screen.getByRole("alertdialog", { name: "로그아웃" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "개인정보 수정", hidden: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "로그아웃", hidden: true })).toBeDisabled();

  await act(async () => logout.resolve({ error: { message: "network failed" } }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("로그아웃하지 못했습니다. 다시 시도해 주세요.");
  expect(router.replace).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog", { name: "로그아웃" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "로그아웃 확인" })).toBeEnabled();
});
