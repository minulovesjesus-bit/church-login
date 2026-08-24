import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  device_name: "본당 입구 태블릿",
  created_at: "2026-08-20T03:00:00Z",
  last_seen_at: "2026-08-22T02:55:00Z",
  refresh_expires_at: "2026-08-23T03:00:00Z",
  revoked_at: null,
};
const expired = {
  ...active,
  session_id: "22222222-2222-4222-8222-222222222222",
  device_name: "교육관 태블릿",
  refresh_expires_at: "2026-08-21T03:00:00Z",
};
const revoked = {
  ...active,
  session_id: "33333333-3333-4333-8333-333333333333",
  device_name: "로비 태블릿",
  revoked_at: "2026-08-22T02:58:00Z",
};
type SessionFixture = Omit<typeof active, "revoked_at"> & { revoked_at: string | null };
const page = (items: SessionFixture[], next_cursor: string | null = null) => ({
  items,
  next_cursor,
  page_size: 100,
});

afterEach(() => {
  vi.restoreAllMocks();
  navigation.replace.mockReset();
  vi.useRealTimers();
});

it("renders bounded safe fields, Seoul timestamps, and active/expired/revoked states", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-22T03:00:00Z"));
  mockApi.get.mockResolvedValue(page([active, expired, revoked]));

  render(<KioskSessionsPage />);

  expect(screen.getByRole("status")).toHaveTextContent("기기 세션을 불러오고 있습니다.");
  await act(async () => {});
  expect(screen.getByText(active.session_id)).toBeVisible();
  expect(screen.getByRole("heading", { name: "본당 입구 태블릿" })).toBeVisible();
  expect(screen.getByText("활성", { selector: ".admin-status" }))
    .toHaveClass("admin-status", "admin-status--active");
  expect(screen.getByText("만료", { selector: ".admin-status" }))
    .toHaveClass("admin-status", "admin-status--expired");
  expect(screen.getByText("해지됨", { selector: ".admin-status" }))
    .toHaveClass("admin-status", "admin-status--revoked");
  expect(formatSeoulTimestamp("2026-08-22T03:00:00Z")).toContain("2026. 8. 22.");
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(document.body).not.toHaveTextContent(/refresh_token|hash|cookie|IP|user.?agent/i);
  expect(screen.getByRole("button", { name: `${active.device_name} 세션 영구 삭제` })).toBeEnabled();
  expect(screen.getByRole("button", { name: `${expired.device_name} 세션 영구 삭제` })).toBeEnabled();
  expect(screen.getByRole("button", { name: `${revoked.device_name} 세션 영구 삭제` })).toBeEnabled();
});

it("uses a titled identity dialog, cancels with exact focus return, locks deletion, and refetches after 204", async () => {
  mockApi.get.mockResolvedValueOnce(page([active])).mockResolvedValueOnce(page([]));
  let finishDelete: (() => void) | undefined;
  mockApi.delete.mockReturnValue(new Promise<void>((resolve) => {
    finishDelete = resolve;
  }));
  render(<KioskSessionsPage />);

  const deleteButton = await screen.findByRole("button", { name: `${active.device_name} 세션 영구 삭제` });
  deleteButton.focus();
  fireEvent.click(deleteButton);
  const firstDialog = screen.getByRole("alertdialog", { name: `${active.device_name} 기기 세션 영구 삭제` });
  expect(firstDialog).toHaveTextContent("비밀번호 입력 화면으로 돌아갑니다");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(mockApi.delete).not.toHaveBeenCalled();
  await waitFor(() => expect(deleteButton).toHaveFocus());

  fireEvent.click(deleteButton);
  fireEvent.click(within(screen.getByRole("alertdialog", { name: `${active.device_name} 기기 세션 영구 삭제` }))
    .getByRole("button", { name: "취소" }));
  expect(mockApi.delete).not.toHaveBeenCalled();
  await waitFor(() => expect(deleteButton).toHaveFocus());

  fireEvent.click(deleteButton);
  const confirm = screen.getByRole("button", { name: "세션 영구 삭제" });
  fireEvent.click(confirm);
  expect(mockApi.delete).toHaveBeenCalledTimes(1);
  expect(mockApi.delete).toHaveBeenCalledWith(
    "/api/admin/kiosk-sessions/11111111-1111-4111-8111-111111111111",
  );
  expect(deleteButton).toBeDisabled();
  await waitFor(() => expect(screen.getByRole("heading", { name: "기기 세션 관리" })).toHaveFocus());

  finishDelete?.();
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("등록된 기기 세션이 없습니다.")).toBeVisible();
});

it("permanently deletes a named kiosk row while preserving attendance copy", async () => {
  mockApi.get.mockResolvedValueOnce(page([active])).mockResolvedValueOnce(page([]));
  mockApi.delete.mockResolvedValue(undefined);
  render(<KioskSessionsPage />);

  fireEvent.click(await screen.findByRole("button", {
    name: `${active.device_name} 세션 영구 삭제`,
  }));
  const dialog = screen.getByRole("alertdialog", {
    name: `${active.device_name} 기기 세션 영구 삭제`,
  });
  expect(dialog).toHaveTextContent("출결 기록은 유지됩니다");
  expect(dialog).toHaveTextContent("비밀번호 입력 화면으로 돌아갑니다");

  fireEvent.click(within(dialog).getByRole("button", { name: "세션 영구 삭제" }));

  await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith(
    `/api/admin/kiosk-sessions/${active.session_id}`,
  ));
  await waitFor(() => expect(screen.queryByText(active.device_name)).not.toBeInTheDocument());
});

it("synchronously locks two distinct deletions before React disables either row", async () => {
  mockApi.get.mockResolvedValue(page([active, expired]));
  mockApi.delete.mockReturnValue(new Promise<void>(() => {}));
  render(<KioskSessionsPage />);

  fireEvent.click(await screen.findByRole("button", { name: `${active.device_name} 세션 영구 삭제` }));
  fireEvent.click(screen.getByRole("button", { name: `${expired.device_name} 세션 영구 삭제`, hidden: true }));
  const [firstConfirm, secondConfirm] = screen.getAllByRole(
    "button",
    { name: "세션 영구 삭제", hidden: true },
  );

  act(() => {
    firstConfirm.click();
    secondConfirm.click();
  });

  expect(mockApi.delete).toHaveBeenCalledTimes(1);
  expect(mockApi.delete).toHaveBeenCalledWith(
    "/api/admin/kiosk-sessions/11111111-1111-4111-8111-111111111111",
  );
});

it("keeps the session and action available when deletion fails", async () => {
  mockApi.get.mockResolvedValue(page([active]));
  mockApi.delete.mockRejectedValue(new ApiClientError("REQUEST_FAILED", "삭제 실패"));
  render(<KioskSessionsPage />);

  fireEvent.click(await screen.findByRole("button", { name: `${active.device_name} 세션 영구 삭제` }));
  fireEvent.click(screen.getByRole("button", { name: "세션 영구 삭제" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("삭제 실패");
  expect(screen.getByText(active.session_id)).toBeVisible();
  expect(screen.getByRole("button", { name: `${active.device_name} 세션 영구 삭제` })).toBeEnabled();
});

it("redirects terminal auth failures and never renders a stale protected list", async () => {
  let resolveList: ((value: ReturnType<typeof page>) => void) | undefined;
  mockApi.get.mockReturnValue(new Promise((resolve) => {
    resolveList = resolve;
  }));
  const view = render(<KioskSessionsPage />);
  view.unmount();
  resolveList?.(page([active]));
  await act(async () => {});
  expect(screen.queryByText(active.session_id)).not.toBeInTheDocument();

  mockApi.get.mockRejectedValue(new ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."));
  render(<KioskSessionsPage />);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
  expect(screen.queryByText(active.session_id)).not.toBeInTheDocument();
});

it("retries a failed list and redirects forbidden administrators to the student dashboard", async () => {
  mockApi.get
    .mockRejectedValueOnce(new ApiClientError("REQUEST_FAILED", "목록 실패"))
    .mockResolvedValueOnce(page([]));
  render(<KioskSessionsPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("목록 실패");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByText("등록된 기기 세션이 없습니다.")).toBeVisible();

  mockApi.get.mockRejectedValue(new ApiClientError("FORBIDDEN", "권한 없음"));
  render(<KioskSessionsPage />);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/student"));
});

it("appends a later page without duplicates and locks competing loads", async () => {
  let resolveNext: ((value: ReturnType<typeof page>) => void) | undefined;
  const later = {
    ...active,
    session_id: "00000000-0000-4000-8000-000000000001",
    created_at: "2026-01-01T03:00:00Z",
  };
  mockApi.get
    .mockResolvedValueOnce(page([active], "opaque+/cursor="))
    .mockReturnValueOnce(new Promise((resolve) => { resolveNext = resolve; }));
  render(<KioskSessionsPage />);

  const loadMore = await screen.findByRole("button", { name: "더 보기" });
  fireEvent.click(loadMore);
  fireEvent.click(loadMore);

  expect(mockApi.get).toHaveBeenCalledTimes(2);
  expect(mockApi.get).toHaveBeenLastCalledWith(
    "/api/admin/kiosk-sessions?page_size=100&cursor=opaque%2B%2Fcursor%3D",
  );
  expect(loadMore).toBeDisabled();
  expect(screen.getByRole("button", { name: `${active.device_name} 세션 영구 삭제` })).toBeDisabled();

  resolveNext?.(page([active, later, later]));
  await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
  expect(screen.getByText(later.session_id)).toBeVisible();
  expect(screen.queryByRole("button", { name: "더 보기" })).not.toBeInTheDocument();
});

it("keeps loaded rows and restores pagination after a transient next-page error", async () => {
  mockApi.get
    .mockResolvedValueOnce(page([active], "retry-page"))
    .mockRejectedValueOnce(new ApiClientError("REQUEST_FAILED", "다음 목록 실패"));
  render(<KioskSessionsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "더 보기" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("다음 목록 실패");
  expect(screen.getByText(active.session_id)).toBeVisible();
  expect(screen.getByRole("button", { name: "더 보기" })).toBeEnabled();
});

it("hides protected rows when a later-page request has terminal authorization failure", async () => {
  mockApi.get
    .mockResolvedValueOnce(page([active], "terminal-page"))
    .mockRejectedValueOnce(new ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."));
  render(<KioskSessionsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "더 보기" }));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
  expect(screen.queryByText(active.session_id)).not.toBeInTheDocument();
});

it("deletes the exact session loaded from a later page", async () => {
  const later = {
    ...active,
    session_id: "00000000-0000-4000-8000-000000000002",
    created_at: "2026-01-01T03:00:00Z",
  };
  mockApi.get
    .mockResolvedValueOnce(page([active], "next-page"))
    .mockResolvedValueOnce(page([later]))
    .mockResolvedValueOnce(page([active], "next-page"))
    .mockResolvedValueOnce(page([]));
  mockApi.delete.mockResolvedValue(undefined);
  render(<KioskSessionsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "더 보기" }));
  const laterCard = (await screen.findByText(later.session_id)).closest("li");
  fireEvent.click(within(laterCard as HTMLElement).getByRole("button", { name: `${later.device_name} 세션 영구 삭제` }));
  fireEvent.click(screen.getByRole("button", { name: "세션 영구 삭제" }));

  await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith(
    `/api/admin/kiosk-sessions/${later.session_id}`,
  ));
  await waitFor(() => expect(screen.queryByText(later.session_id)).not.toBeInTheDocument());
});
