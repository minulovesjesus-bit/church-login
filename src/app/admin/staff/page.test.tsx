import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
const ApiClientError = vi.hoisted(() => class extends Error {
  constructor(public code: string, message: string) { super(message); }
});
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/lib/api/client", () => ({ api: mockApi, ApiClientError }));

import StaffPage from "./page";

const teacher = {
  user_id: "11111111-1111-4111-8111-111111111111",
  email: "teacher@example.com",
  name: "김교사",
  phone: null,
  role: "teacher" as const,
};
const admin = { ...teacher, role: "admin" as const };

afterEach(() => {
  vi.restoreAllMocks();
  navigation.replace.mockReset();
});

it("loads, promotes with confirmation, and never renders the raw user UUID", async () => {
  mockApi.get.mockResolvedValue([teacher]);
  mockApi.patch.mockResolvedValue(admin);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<StaffPage />);

  expect(screen.getByRole("status")).toHaveTextContent("교직원 목록을 불러오고 있습니다.");
  fireEvent.click(await screen.findByRole("button", { name: "관리자로 승격" }));

  expect(window.confirm).toHaveBeenCalledWith(
    "김교사 님을 관리자로 승격하시겠습니까? 관리자 전용 기능을 사용할 수 있게 됩니다.",
  );
  await waitFor(() => expect(screen.getByText("관리자")).toBeVisible());
  expect(document.body).not.toHaveTextContent(teacher.user_id);
});

it("preserves the last administrator row and active action on LAST_ADMIN_PROTECTED", async () => {
  mockApi.get.mockResolvedValue([admin]);
  mockApi.patch.mockRejectedValue(new ApiClientError("LAST_ADMIN_PROTECTED", "마지막 관리자는 변경할 수 없습니다."));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<StaffPage />);

  fireEvent.click(await screen.findByRole("button", { name: "교사로 변경" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("마지막 관리자는 변경할 수 없습니다.");
  expect(screen.getByText("관리자")).toBeVisible();
  expect(screen.getByRole("button", { name: "교사로 변경" })).toBeEnabled();
});

it("cancels without mutation, locks duplicate actions, and redirects terminal auth", async () => {
  mockApi.get.mockResolvedValue([teacher]);
  let finish: ((value: typeof admin) => void) | undefined;
  mockApi.patch.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
  render(<StaffPage />);

  const action = await screen.findByRole("button", { name: "관리자로 승격" });
  fireEvent.click(action);
  expect(mockApi.patch).not.toHaveBeenCalled();
  fireEvent.click(action);
  fireEvent.click(action);
  expect(mockApi.patch).toHaveBeenCalledTimes(1);
  finish?.(admin);
  await waitFor(() => expect(screen.getByText("관리자")).toBeVisible());

  mockApi.get.mockRejectedValue(new ApiClientError("FORBIDDEN", "권한 없음"));
  render(<StaffPage />);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/teacher"));
});

it("shows empty/error/retry states and redirects AUTH_REQUIRED", async () => {
  mockApi.get
    .mockRejectedValueOnce(new ApiClientError("REQUEST_FAILED", "목록 실패"))
    .mockResolvedValueOnce([]);
  render(<StaffPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("목록 실패");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByText("등록된 교직원이 없습니다.")).toBeVisible();

  mockApi.get.mockRejectedValue(new ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."));
  render(<StaffPage />);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/teacher/login"));
});
