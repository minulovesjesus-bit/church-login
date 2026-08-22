import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  phone: "01011112222",
  role: "teacher" as const,
};
const admin = { ...teacher, role: "admin" as const };
const otherAdmin = {
  user_id: "22222222-2222-4222-8222-222222222222",
  email: "other.admin@example.com",
  name: "이관리자",
  phone: "01022223333",
  role: "admin" as const,
};
const returnedAdmin = {
  user_id: "11111111-1111-4111-8111-111111111111",
  email: "renamed.teacher@example.com",
  name: "서버반환교사",
  phone: "01099998888",
  role: "admin" as const,
};

afterEach(() => {
  vi.restoreAllMocks();
  navigation.replace.mockReset();
});

it("patches the exact promotion contract and replaces only the target with the complete returned row", async () => {
  mockApi.get.mockResolvedValue([teacher, otherAdmin]);
  let finish: ((value: typeof returnedAdmin) => void) | undefined;
  mockApi.patch.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<StaffPage />);

  expect(screen.getByRole("status")).toHaveTextContent("교직원 목록을 불러오고 있습니다.");
  const opener = await screen.findByRole("button", { name: "김교사 님 관리자로 승격" });
  expect(opener).toHaveTextContent("관리자로 승격");
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole("alertdialog", { name: "김교사 님 관리자 승격" });
  expect(dialog).toHaveTextContent("김교사 님을 관리자로 승격하시겠습니까? 관리자 전용 기능을 사용할 수 있게 됩니다.");
  fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
  expect(mockApi.patch).not.toHaveBeenCalled();
  await waitFor(() => expect(opener).toHaveFocus());

  fireEvent.click(opener);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(mockApi.patch).not.toHaveBeenCalled();
  await waitFor(() => expect(opener).toHaveFocus());

  fireEvent.click(opener);
  const confirm = screen.getByRole("button", { name: "김교사 님 관리자 승격 확인" });
  fireEvent.click(confirm);
  expect(mockApi.patch).toHaveBeenCalledTimes(1);
  expect(mockApi.patch).toHaveBeenCalledWith(
    "/api/admin/staff/11111111-1111-4111-8111-111111111111/role",
    { role: "admin" },
  );
  await waitFor(() => expect(screen.getByRole("heading", { name: "교직원 역할 관리" })).toHaveFocus());
  finish?.(returnedAdmin);
  expect(await screen.findByText("서버반환교사")).toBeVisible();
  expect(screen.getByText("renamed.teacher@example.com")).toBeVisible();
  expect(screen.getByText("01099998888")).toBeVisible();
  expect(screen.getByRole("button", { name: "서버반환교사 님 교사로 변경" })).toBeEnabled();
  expect(screen.queryByText("teacher@example.com")).not.toBeInTheDocument();
  expect(screen.queryByText("01011112222")).not.toBeInTheDocument();
  expect(screen.getByText("이관리자")).toBeVisible();
  expect(screen.getByText("other.admin@example.com")).toBeVisible();
  expect(document.body).not.toHaveTextContent(teacher.user_id);
});

it("patches the exact demotion contract", async () => {
  mockApi.get.mockResolvedValue([otherAdmin]);
  mockApi.patch.mockResolvedValue({ ...otherAdmin, role: "teacher" as const });
  render(<StaffPage />);

  fireEvent.click(await screen.findByRole("button", { name: "이관리자 님 교사로 변경" }));
  fireEvent.click(screen.getByRole("button", { name: "이관리자 님 교사 변경 확인" }));

  expect(mockApi.patch).toHaveBeenCalledTimes(1);
  expect(mockApi.patch).toHaveBeenCalledWith(
    "/api/admin/staff/22222222-2222-4222-8222-222222222222/role",
    { role: "teacher" },
  );
  expect(await screen.findByRole("button", { name: "이관리자 님 관리자로 승격" })).toBeEnabled();
});

it("preserves the last administrator row and active action on LAST_ADMIN_PROTECTED", async () => {
  mockApi.get.mockResolvedValue([admin]);
  mockApi.patch.mockRejectedValue(new ApiClientError("LAST_ADMIN_PROTECTED", "마지막 관리자는 변경할 수 없습니다."));
  render(<StaffPage />);

  fireEvent.click(await screen.findByRole("button", { name: "김교사 님 교사로 변경" }));
  fireEvent.click(screen.getByRole("button", { name: "김교사 님 교사 변경 확인" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("마지막 관리자는 변경할 수 없습니다.");
  expect(screen.getByText("관리자")).toBeVisible();
  expect(screen.getByRole("button", { name: "김교사 님 교사로 변경" })).toBeEnabled();
});

it("renders the API current role without treating the configured initial email as permanently admin", async () => {
  mockApi.get.mockResolvedValue([
    { ...teacher, email: "initial@example.com", name: "초기관리자" },
    otherAdmin,
  ]);
  render(<StaffPage />);

  const role = await screen.findByText("교사", { selector: ".admin-status" });
  expect(role).toHaveClass("admin-status", "admin-status--teacher");
  expect(screen.getByText("관리자", { selector: ".admin-status" }))
    .toHaveClass("admin-status", "admin-status--admin");
  expect(screen.getByRole("button", { name: "초기관리자 님 관리자로 승격" })).toBeEnabled();
});

it("synchronously locks two distinct role changes before React disables either row", async () => {
  mockApi.get.mockResolvedValue([teacher, otherAdmin]);
  mockApi.patch.mockReturnValue(new Promise(() => {}));
  render(<StaffPage />);

  fireEvent.click(await screen.findByRole("button", { name: "김교사 님 관리자로 승격" }));
  fireEvent.click(screen.getByRole("button", { name: "이관리자 님 교사로 변경", hidden: true }));
  const promote = screen.getByRole("button", { name: "김교사 님 관리자 승격 확인", hidden: true });
  const demote = screen.getByRole("button", { name: "이관리자 님 교사 변경 확인" });

  act(() => {
    promote.click();
    demote.click();
  });

  expect(mockApi.patch).toHaveBeenCalledTimes(1);
  expect(mockApi.patch).toHaveBeenCalledWith(
    "/api/admin/staff/11111111-1111-4111-8111-111111111111/role",
    { role: "admin" },
  );
});

it("keeps the prior row after an ordinary failure, unlocks, and permits a later success", async () => {
  mockApi.get.mockResolvedValue([teacher, otherAdmin]);
  mockApi.patch
    .mockRejectedValueOnce(new ApiClientError("REQUEST_FAILED", "역할 변경 실패"))
    .mockResolvedValueOnce(returnedAdmin);
  render(<StaffPage />);

  fireEvent.click(await screen.findByRole("button", { name: "김교사 님 관리자로 승격" }));
  fireEvent.click(screen.getByRole("button", { name: "김교사 님 관리자 승격 확인" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("역할 변경 실패");
  expect(screen.getByText("김교사")).toBeVisible();
  expect(screen.getByText("teacher@example.com")).toBeVisible();
  expect(screen.getByText("교사", { selector: ".admin-status" })).toBeVisible();
  const retry = screen.getByRole("button", { name: "김교사 님 관리자로 승격" });
  expect(retry).toBeEnabled();
  expect(screen.getByText("이관리자")).toBeVisible();

  fireEvent.click(retry);
  fireEvent.click(screen.getByRole("button", { name: "김교사 님 관리자 승격 확인" }));

  expect(mockApi.patch).toHaveBeenCalledTimes(2);
  expect(mockApi.patch).toHaveBeenNthCalledWith(
    2,
    "/api/admin/staff/11111111-1111-4111-8111-111111111111/role",
    { role: "admin" },
  );
  expect(await screen.findByText("서버반환교사")).toBeVisible();
  expect(screen.queryByText("teacher@example.com")).not.toBeInTheDocument();
});

it("redirects forbidden staff lists", async () => {
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
