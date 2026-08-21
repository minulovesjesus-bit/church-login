import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
const ApiClientError = vi.hoisted(() => class extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
});

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/lib/api/client", () => ({ api: mockApi, ApiClientError }));

import KioskSessionsPage, { formatSeoulTimestamp } from "./page";

const active = {
  session_id: "11111111-1111-4111-8111-111111111111",
  created_at: "2026-08-20T03:00:00Z",
  last_seen_at: "2026-08-22T02:55:00Z",
  refresh_expires_at: "2026-08-23T03:00:00Z",
  revoked_at: null,
};
const expired = {
  ...active,
  session_id: "22222222-2222-4222-8222-222222222222",
  refresh_expires_at: "2026-08-21T03:00:00Z",
};
const revoked = {
  ...active,
  session_id: "33333333-3333-4333-8333-333333333333",
  revoked_at: "2026-08-22T02:58:00Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  navigation.replace.mockReset();
  vi.useRealTimers();
});

it("renders bounded safe fields, Seoul timestamps, and active/expired/revoked states", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-22T03:00:00Z"));
  mockApi.get.mockResolvedValue([active, expired, revoked]);

  render(<KioskSessionsPage />);

  expect(screen.getByRole("status")).toHaveTextContent("기기 세션을 불러오고 있습니다.");
  await act(async () => {});
  expect(screen.getByText(active.session_id)).toBeVisible();
  expect(screen.getByText("활성")).toBeVisible();
  expect(screen.getByText("만료", { selector: ".admin-status" })).toBeVisible();
  expect(screen.getByText("해지됨")).toBeVisible();
  expect(formatSeoulTimestamp("2026-08-22T03:00:00Z")).toContain("2026. 8. 22.");
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(document.body).not.toHaveTextContent(/refresh_token|hash|cookie|IP|user.?agent/i);
  expect(screen.getAllByRole("button", { name: "세션 해지" })).toHaveLength(2);
  expect(screen.getByRole("button", { name: "해지 완료" })).toBeDisabled();
});

it("cancels without a request, locks duplicate revokes, and refetches after 204", async () => {
  mockApi.get.mockResolvedValueOnce([active]).mockResolvedValueOnce([revoked]);
  let finishDelete: (() => void) | undefined;
  mockApi.delete.mockReturnValue(new Promise<void>((resolve) => {
    finishDelete = resolve;
  }));
  vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
  render(<KioskSessionsPage />);

  const revoke = await screen.findByRole("button", { name: "세션 해지" });
  fireEvent.click(revoke);
  expect(mockApi.delete).not.toHaveBeenCalled();

  fireEvent.click(revoke);
  fireEvent.click(revoke);
  expect(window.confirm).toHaveBeenLastCalledWith(
    `${active.session_id} 기기 세션을 해지하시겠습니까? 즉시 QR 발급과 갱신이 중단됩니다.`,
  );
  expect(mockApi.delete).toHaveBeenCalledTimes(1);
  expect(revoke).toBeDisabled();

  finishDelete?.();
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("해지됨")).toBeVisible();
});

it("keeps the session and action available when revocation fails", async () => {
  mockApi.get.mockResolvedValue([active]);
  mockApi.delete.mockRejectedValue(new ApiClientError("REQUEST_FAILED", "해지 실패"));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<KioskSessionsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "세션 해지" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("해지 실패");
  expect(screen.getByText(active.session_id)).toBeVisible();
  expect(screen.getByRole("button", { name: "세션 해지" })).toBeEnabled();
});

it("redirects terminal auth failures and never renders a stale protected list", async () => {
  let resolveList: ((value: typeof active[]) => void) | undefined;
  mockApi.get.mockReturnValue(new Promise((resolve) => {
    resolveList = resolve;
  }));
  const view = render(<KioskSessionsPage />);
  view.unmount();
  resolveList?.([active]);
  await act(async () => {});
  expect(screen.queryByText(active.session_id)).not.toBeInTheDocument();

  mockApi.get.mockRejectedValue(new ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."));
  render(<KioskSessionsPage />);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/teacher/login"));
  expect(screen.queryByText(active.session_id)).not.toBeInTheDocument();
});

it("retries a failed list and redirects forbidden administrators to the teacher home", async () => {
  mockApi.get
    .mockRejectedValueOnce(new ApiClientError("REQUEST_FAILED", "목록 실패"))
    .mockResolvedValueOnce([]);
  render(<KioskSessionsPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("목록 실패");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByText("등록된 기기 세션이 없습니다.")).toBeVisible();

  mockApi.get.mockRejectedValue(new ApiClientError("FORBIDDEN", "권한 없음"));
  render(<KioskSessionsPage />);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/teacher"));
});
