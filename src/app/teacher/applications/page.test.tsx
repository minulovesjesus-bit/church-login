import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
const ApiClientError = vi.hoisted(() => class extends Error {
  constructor(public code: string, message: string) { super(message); }
});
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/lib/api/client", () => ({ api: mockApi, ApiClientError }));

import TeacherApplicationsPage from "./page";

const application = {
  id: "8d793e62-da07-4d0c-9d19-f9b50dc7b585",
  user_id: "f272cb70-a2c2-4a49-94a1-309427635571",
  email: "teacher@example.com",
  name: "김교사",
  phone: "01011112222",
  status: "pending" as const,
};

afterEach(() => {
  vi.restoreAllMocks();
  navigation.replace.mockReset();
});

it("shows loading, empty, error, and retry states", async () => {
  mockApi.get
    .mockRejectedValueOnce(new ApiClientError("REQUEST_FAILED", "목록 실패"))
    .mockResolvedValueOnce([]);
  render(<TeacherApplicationsPage />);
  expect(screen.getByRole("status")).toHaveTextContent("신청 목록을 불러오고 있습니다.");
  expect(await screen.findByRole("alert")).toHaveTextContent("목록 실패");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByText("대기 중인 신청이 없습니다.")).toBeVisible();
});

it("confirms approval, locks duplicate actions synchronously, and removes only on success", async () => {
  mockApi.get.mockResolvedValue([application]);
  let finish: (() => void) | undefined;
  mockApi.post.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<TeacherApplicationsPage />);

  const approve = await screen.findByRole("button", { name: "승인" });
  fireEvent.click(approve);
  fireEvent.click(approve);
  expect(window.confirm).toHaveBeenCalledWith("김교사 님을 교사로 승인하시겠습니까? 즉시 교사 기능을 사용할 수 있게 됩니다.");
  expect(mockApi.post).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole("button", { name: "처리 중…" })).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: "처리 중…" })[0]).toBeDisabled();

  finish?.();
  expect(await screen.findByText("대기 중인 신청이 없습니다.")).toBeVisible();
});

it("opens an accessible target-owned rejection dialog and validates a trimmed 1..500 character reason", async () => {
  mockApi.get.mockResolvedValue([application]);
  mockApi.post.mockResolvedValue({});
  render(<TeacherApplicationsPage />);

  const reject = await screen.findByRole("button", { name: "거절" });
  fireEvent.click(reject);
  const dialog = screen.getByRole("dialog", { name: "김교사 님 신청 거절" });
  const reason = screen.getByRole("textbox", { name: "거절 사유" });
  expect(dialog).toHaveTextContent("김교사 님의 교사 신청을 거절합니다.");
  expect(reason).toHaveAttribute("maxlength", "500");
  expect(reason).toHaveFocus();

  fireEvent.change(reason, { target: { value: "   " } });
  fireEvent.click(screen.getByRole("button", { name: "김교사 님 신청 거절 확정" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("거절 사유를 입력해 주세요.");

  fireEvent.change(reason, { target: { value: "x".repeat(501) } });
  fireEvent.click(screen.getByRole("button", { name: "김교사 님 신청 거절 확정" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("거절 사유는 500자 이하여야 합니다.");
  expect(mockApi.post).not.toHaveBeenCalled();
});

it("preserves the exact rejection draft after failure and reuses it on a locked retry", async () => {
  mockApi.get.mockResolvedValue([application]);
  let finish: (() => void) | undefined;
  mockApi.post
    .mockRejectedValueOnce(new ApiClientError("REQUEST_FAILED", "거절 처리 실패"))
    .mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<TeacherApplicationsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "거절" }));
  const reason = screen.getByRole("textbox", { name: "거절 사유" });
  fireEvent.change(reason, { target: { value: "  정보 확인 필요  " } });
  fireEvent.click(screen.getByRole("button", { name: "김교사 님 신청 거절 확정" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("거절 처리 실패");
  expect(screen.getByRole("dialog", { name: "김교사 님 신청 거절" })).toBeVisible();
  expect(reason).toHaveValue("  정보 확인 필요  ");

  const submit = screen.getByRole("button", { name: "김교사 님 신청 거절 확정" });
  fireEvent.click(submit);
  fireEvent.click(submit);
  fireEvent.click(screen.getByRole("button", { name: "승인" }));
  expect(mockApi.post).toHaveBeenCalledTimes(2);
  expect(window.confirm).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "승인" })).toBeDisabled();
  expect(mockApi.post).toHaveBeenNthCalledWith(
    1,
    `/api/admin/teacher-applications/${application.id}/reject`,
    { rejection_reason: "정보 확인 필요" },
  );
  expect(mockApi.post).toHaveBeenNthCalledWith(
    2,
    `/api/admin/teacher-applications/${application.id}/reject`,
    { rejection_reason: "정보 확인 필요" },
  );
  expect(mockApi.post.mock.calls[0][0]).not.toContain("정보 확인 필요");

  finish?.();
  expect(await screen.findByText("대기 중인 신청이 없습니다.")).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("clears a rejection draft only when the administrator explicitly cancels", async () => {
  mockApi.get.mockResolvedValue([application]);
  render(<TeacherApplicationsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "거절" }));
  fireEvent.change(screen.getByRole("textbox", { name: "거절 사유" }), { target: { value: "취소할 사유" } });
  fireEvent.click(screen.getByRole("button", { name: "거절 취소" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mockApi.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "거절" }));
  expect(screen.getByRole("textbox", { name: "거절 사유" })).toHaveValue("");
});

it("refreshes an already-reviewed conflict instead of presenting duplicate success", async () => {
  mockApi.get.mockResolvedValueOnce([application]).mockResolvedValueOnce([]);
  mockApi.post.mockRejectedValue(new ApiClientError("APPLICATION_ALREADY_REVIEWED", "이미 처리된 신청입니다."));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<TeacherApplicationsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "승인" }));
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("대기 중인 신청이 없습니다.")).toBeVisible();
  expect(screen.queryByText(/승인했습니다/)).not.toBeInTheDocument();
});

it("clears a rejection draft when conflict reconciliation proves the item was removed", async () => {
  mockApi.get.mockResolvedValueOnce([application]).mockResolvedValueOnce([]);
  mockApi.post.mockRejectedValue(new ApiClientError("APPLICATION_ALREADY_REVIEWED", "이미 처리된 신청입니다."));
  render(<TeacherApplicationsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "거절" }));
  fireEvent.change(screen.getByRole("textbox", { name: "거절 사유" }), { target: { value: "이미 처리됨" } });
  fireEvent.click(screen.getByRole("button", { name: "김교사 님 신청 거절 확정" }));

  expect(await screen.findByText("대기 중인 신청이 없습니다.")).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText(/거절했습니다/)).not.toBeInTheDocument();
});

it("keeps the successful list and retries only reconciliation after its GET fails", async () => {
  let resolveRetry: ((applications: typeof application[]) => void) | undefined;
  mockApi.get
    .mockResolvedValueOnce([application])
    .mockRejectedValueOnce(new ApiClientError("REQUEST_FAILED", "신청 상태 확인 실패"))
    .mockReturnValueOnce(new Promise((resolve) => { resolveRetry = resolve; }));
  mockApi.post.mockRejectedValue(new ApiClientError("APPLICATION_ALREADY_REVIEWED", "이미 처리된 신청입니다."));
  render(<TeacherApplicationsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "거절" }));
  fireEvent.change(screen.getByRole("textbox", { name: "거절 사유" }), { target: { value: "  그대로 둘 사유  " } });
  fireEvent.click(screen.getByRole("button", { name: "김교사 님 신청 거절 확정" }));

  const dialog = await screen.findByRole("dialog", { name: "김교사 님 신청 거절" });
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
  expect(screen.getByText("teacher@example.com")).toBeVisible();
  expect(within(dialog).getByRole("alert")).toHaveTextContent("신청 상태 확인 실패");
  expect(within(dialog).getByRole("textbox", { name: "거절 사유" })).toHaveValue("  그대로 둘 사유  ");

  const retry = within(dialog).getByRole("button", { name: "신청 상태 다시 확인" });
  fireEvent.click(retry);
  fireEvent.click(retry);
  fireEvent.click(screen.getByRole("button", { name: "승인" }));
  expect(mockApi.post).toHaveBeenCalledTimes(1);
  expect(mockApi.get).toHaveBeenCalledTimes(3);
  expect(screen.getByRole("button", { name: "승인" })).toBeDisabled();

  resolveRetry?.([]);
  expect(await screen.findByText("이미 처리된 신청을 목록에서 정리했습니다.")).toHaveAttribute("role", "status");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mockApi.post).toHaveBeenCalledTimes(1);
});

it("retains the draft and retry control after repeated reconciliation GET failures", async () => {
  mockApi.get
    .mockResolvedValueOnce([application])
    .mockRejectedValueOnce(new ApiClientError("REQUEST_FAILED", "첫 상태 확인 실패"))
    .mockRejectedValueOnce(new ApiClientError("REQUEST_FAILED", "다시 상태 확인 실패"));
  mockApi.post.mockRejectedValue(new ApiClientError("APPLICATION_ALREADY_REVIEWED", "이미 처리된 신청입니다."));
  render(<TeacherApplicationsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "거절" }));
  fireEvent.change(screen.getByRole("textbox", { name: "거절 사유" }), { target: { value: "  실패 후 유지  " } });
  fireEvent.click(screen.getByRole("button", { name: "김교사 님 신청 거절 확정" }));
  const retry = await screen.findByRole("button", { name: "신청 상태 다시 확인" });
  fireEvent.click(retry);

  const dialog = screen.getByRole("dialog", { name: "김교사 님 신청 거절" });
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("다시 상태 확인 실패");
  expect(within(dialog).getByRole("textbox", { name: "거절 사유" })).toHaveValue("  실패 후 유지  ");
  expect(within(dialog).getByRole("button", { name: "신청 상태 다시 확인" })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: "거절 취소" })).toBeEnabled();
  expect(mockApi.post).toHaveBeenCalledTimes(1);
});

it("keeps the draft and stable conflict feedback when retry still finds the item", async () => {
  mockApi.get
    .mockResolvedValueOnce([application])
    .mockRejectedValueOnce(new ApiClientError("REQUEST_FAILED", "신청 상태 확인 실패"))
    .mockResolvedValueOnce([application]);
  mockApi.post.mockRejectedValue(new ApiClientError("APPLICATION_ALREADY_REVIEWED", "이미 처리된 신청입니다."));
  render(<TeacherApplicationsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "거절" }));
  fireEvent.change(screen.getByRole("textbox", { name: "거절 사유" }), { target: { value: "  재확인할 사유  " } });
  fireEvent.click(screen.getByRole("button", { name: "김교사 님 신청 거절 확정" }));
  fireEvent.click(await screen.findByRole("button", { name: "신청 상태 다시 확인" }));

  const dialog = screen.getByRole("dialog", { name: "김교사 님 신청 거절" });
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("이미 처리된 신청입니다.");
  expect(within(dialog).getByRole("textbox", { name: "거절 사유" })).toHaveValue("  재확인할 사유  ");
  expect(within(dialog).getByRole("button", { name: "신청 상태 다시 확인" })).toBeEnabled();
  expect(mockApi.post).toHaveBeenCalledTimes(1);
});

it("closes once on terminal auth during reconciliation retry", async () => {
  mockApi.get
    .mockResolvedValueOnce([application])
    .mockRejectedValueOnce(new ApiClientError("REQUEST_FAILED", "신청 상태 확인 실패"))
    .mockRejectedValueOnce(new ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."));
  mockApi.post.mockRejectedValue(new ApiClientError("APPLICATION_ALREADY_REVIEWED", "이미 처리된 신청입니다."));
  render(<TeacherApplicationsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "거절" }));
  fireEvent.change(screen.getByRole("textbox", { name: "거절 사유" }), { target: { value: "보이면 안 되는 사유" } });
  fireEvent.click(screen.getByRole("button", { name: "김교사 님 신청 거절 확정" }));
  fireEvent.click(await screen.findByRole("button", { name: "신청 상태 다시 확인" }));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1));
  expect(navigation.replace).toHaveBeenCalledWith("/teacher/login");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText("김교사")).not.toBeInTheDocument();
  expect(mockApi.post).toHaveBeenCalledTimes(1);
});

it("clears the rejection form and protected queue on terminal mutation auth", async () => {
  mockApi.get.mockResolvedValue([application]);
  mockApi.post.mockRejectedValue(new ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."));
  render(<TeacherApplicationsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "거절" }));
  fireEvent.change(screen.getByRole("textbox", { name: "거절 사유" }), { target: { value: "보이면 안 되는 사유" } });
  fireEvent.click(screen.getByRole("button", { name: "김교사 님 신청 거절 확정" }));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/teacher/login"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText("김교사")).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent("보이면 안 되는 사유");
});

it("redirects terminal auth, hides protected rows, and ignores unmounted completions", async () => {
  mockApi.get.mockRejectedValueOnce(new ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."));
  const first = render(<TeacherApplicationsPage />);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/teacher/login"));
  expect(screen.queryByText("김교사")).not.toBeInTheDocument();
  first.unmount();

  let resolveList: ((value: typeof application[]) => void) | undefined;
  mockApi.get.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
  const second = render(<TeacherApplicationsPage />);
  second.unmount();
  resolveList?.([application]);
  await act(async () => {});
  expect(screen.queryByText("김교사")).not.toBeInTheDocument();

  mockApi.get.mockRejectedValue(new ApiClientError("FORBIDDEN", "권한 없음"));
  render(<TeacherApplicationsPage />);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/teacher"));
});

it("does not render internal user UUIDs", async () => {
  mockApi.get.mockResolvedValue([application]);
  render(<TeacherApplicationsPage />);
  expect(await screen.findByText("김교사")).toBeVisible();
  expect(document.body).not.toHaveTextContent(application.user_id);
});
