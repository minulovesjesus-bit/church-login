import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
const client = vi.hoisted(() => {
  class TestApiClientError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }

  return {
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    ApiClientError: TestApiClientError,
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/lib/api/client", () => client);

import TeacherEventsPage, { TeacherEventsManager } from "./page";

const series = (overrides: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-000000000301",
  title: "주일예배",
  description: "함께 예배드려요",
  location: "본당",
  starts_at: "2026-08-23T02:00:00Z",
  ends_at: "2026-08-23T03:30:00Z",
  repeat_weekly: true,
  repeat_until: "2026-12-27",
  created_by: "00000000-0000-4000-8000-000000000201",
  created_at: "2026-08-21T00:00:00Z",
  updated_at: "2026-08-21T00:00:00Z",
  ...overrides,
});

const page = (items: ReturnType<typeof series>[], overrides: Record<string, unknown> = {}) => ({
  items,
  total: items.length,
  page: 1,
  page_size: 100,
  ...overrides,
});

afterEach(() => {
  Object.values(client.api).forEach((mock) => mock.mockReset());
  navigation.replace.mockReset();
  vi.unstubAllGlobals();
});

it("loads a bounded first page, sorts by start then id, and renders semantic Seoul times", async () => {
  client.api.get.mockResolvedValue(page([
    series({ id: "event-b", title: "나중 ID", starts_at: "2026-08-24T02:00:00Z", ends_at: "2026-08-24T03:00:00Z", repeat_weekly: false, repeat_until: null }),
    series({ id: "event-c", title: "가장 늦음", starts_at: "2026-08-25T02:00:00Z", ends_at: "2026-08-25T03:00:00Z", repeat_until: null }),
    series({ id: "event-a", title: "먼저 ID", starts_at: "2026-08-24T02:00:00Z", ends_at: "2026-08-24T03:00:00Z", repeat_until: null }),
  ], { total: 3 }));

  render(<TeacherEventsPage />);

  expect(screen.getByRole("status")).toHaveTextContent("일정 목록을 불러오고 있습니다.");
  const list = await screen.findByRole("list", { name: "등록된 일정" });
  expect(client.api.get).toHaveBeenCalledWith("/api/teacher/events?page=1&page_size=100");
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    expect.stringContaining("먼저 ID"),
    expect.stringContaining("나중 ID"),
    expect.stringContaining("가장 늦음"),
  ]);
  expect(within(list).getAllByRole("time")[0]).toHaveAttribute("datetime", "2026-08-24T02:00:00Z");
  expect(within(list).getAllByRole("time")[0]).toHaveTextContent("2026년 8월 24일");
  expect(within(list).getByText("한 번")).toBeInTheDocument();
  expect(within(list).getAllByText("매주 · 종료일 없음")).toHaveLength(2);
});

it("renders empty, retryable error, and retry states", async () => {
  client.api.get
    .mockRejectedValueOnce(new client.ApiClientError("REQUEST_FAILED", "일정을 불러오지 못했습니다."))
    .mockResolvedValueOnce(page([]));

  render(<TeacherEventsPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("일정을 불러오지 못했습니다.");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByText("등록된 일정이 없습니다.")).toBeInTheDocument();
  expect(client.api.get).toHaveBeenCalledTimes(2);
});

it.each([
  ["AUTH_REQUIRED", "/teacher/login"],
  ["FORBIDDEN", "/teacher/apply"],
])("redirects %s list failures to the correct teacher route", async (code, destination) => {
  client.api.get.mockRejectedValue(new client.ApiClientError(code, "접근할 수 없습니다."));

  render(<TeacherEventsPage />);

  await vi.waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(destination));
  await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "일정 관리" })).not.toBeInTheDocument());
});

it("ignores stale page responses and completions after unmount", async () => {
  let resolveFirst: (value: ReturnType<typeof page>) => void = () => undefined;
  let resolveSecond: (value: ReturnType<typeof page>) => void = () => undefined;
  client.api.get
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

  const view = render(<TeacherEventsPage />);
  await vi.waitFor(() => expect(client.api.get).toHaveBeenCalledTimes(1));
  client.api.get.mockResolvedValueOnce(page([series({ title: "새 요청 일정" })]));
  fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
  await vi.waitFor(() => expect(client.api.get).toHaveBeenCalledTimes(2));

  await act(async () => {
    resolveSecond(page([series({ title: "최신 일정" })]));
    await Promise.resolve();
  });
  expect(await screen.findByText("최신 일정")).toBeInTheDocument();

  await act(async () => {
    resolveFirst(page([series({ title: "오래된 일정" })]));
    await Promise.resolve();
  });
  expect(screen.queryByText("오래된 일정")).not.toBeInTheDocument();
  view.unmount();
  await Promise.resolve();
});

it("uses total-based controls to continue to row 101 instead of truncating it", async () => {
  client.api.get
    .mockResolvedValueOnce(page([series({ title: "첫 페이지 일정" })], { total: 101 }))
    .mockResolvedValueOnce(page([series({ id: "event-101", title: "101번째 일정" })], { total: 101, page: 2 }));

  render(<TeacherEventsPage />);
  await screen.findByText("첫 페이지 일정");
  expect(screen.getByText("1 / 2 페이지 · 총 101건")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));

  expect(await screen.findByText("101번째 일정")).toBeInTheDocument();
  expect(client.api.get).toHaveBeenLastCalledWith("/api/teacher/events?page=2&page_size=100");
  expect(screen.getByRole("button", { name: "다음 페이지" })).toBeDisabled();
});

it("prefills an edit, warns about the whole series, and preserves the row on update failure", async () => {
  client.api.get.mockResolvedValue(page([series()]));
  client.api.patch.mockRejectedValue(
    new client.ApiClientError("VALIDATION_ERROR", "수정 요청을 확인해 주세요."),
  );
  render(<TeacherEventsPage />);
  await screen.findByText("주일예배");

  fireEvent.click(screen.getByRole("button", { name: "주일예배 수정" }));
  expect(screen.getByLabelText("제목")).toHaveValue("주일예배");
  expect(screen.getByText("반복 일정 전체가 변경됩니다.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("제목"), { target: { value: "수정 중인 예배" } });
  fireEvent.click(screen.getByRole("button", { name: "일정 저장" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("수정 요청을 확인해 주세요.");
  expect(screen.getByText("주일예배")).toBeInTheDocument();
  expect(client.api.get).toHaveBeenCalledTimes(1);
});

it("opens a named AlertDialog for recurring deletion and cancels without a request", async () => {
  client.api.get.mockResolvedValue(page([series()]));
  const confirm = vi.fn();
  vi.stubGlobal("confirm", confirm);
  render(<TeacherEventsPage />);
  await screen.findByText("주일예배");

  const opener = screen.getByRole("button", { name: "주일예배 삭제" });
  opener.focus();
  fireEvent.click(opener);

  const dialog = await screen.findByRole("alertdialog", { name: "주일예배 반복 일정 삭제" });
  expect(within(dialog).getByText("주일예배 반복 일정 전체를 삭제하시겠습니까?")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "주일예배 삭제 확인" })).toHaveTextContent("삭제");
  fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));

  expect(confirm).not.toHaveBeenCalled();
  expect(client.api.delete).not.toHaveBeenCalled();
  expect(screen.getByText("주일예배")).toBeInTheDocument();
  await vi.waitFor(() => expect(opener).toHaveFocus());
});

it("moves focus to the persistent event-list heading while confirmed deletion is pending", async () => {
  let resolveDelete: () => void = () => undefined;
  client.api.get.mockResolvedValue(page([series()]));
  client.api.delete.mockImplementation(() => new Promise<void>((resolve) => { resolveDelete = resolve; }));
  render(<TeacherEventsPage />);
  await screen.findByText("주일예배");

  fireEvent.click(screen.getByRole("button", { name: "주일예배 삭제" }));
  fireEvent.click(await screen.findByRole("button", { name: "주일예배 삭제 확인" }));

  const heading = screen.getByRole("heading", { name: "등록된 일정" });
  await vi.waitFor(() => expect(client.api.delete).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(heading).toHaveFocus());
  expect(screen.getByRole("button", { name: "주일예배 삭제" })).toBeDisabled();

  await act(async () => {
    resolveDelete();
    await Promise.resolve();
  });
});

it("handles DELETE 204, announces success, and moves back after deleting a sole later-page item", async () => {
  client.api.get
    .mockResolvedValueOnce(page([series({ id: "event-101", title: "마지막 반복 일정" })], { total: 101, page: 2 }))
    .mockResolvedValueOnce(page([series({ id: "event-100", title: "이전 페이지 일정" })], { total: 100, page: 1 }));
  client.api.delete.mockResolvedValue(undefined);
  render(<TeacherEventsManager initialPage={2} />);
  await screen.findByText("마지막 반복 일정");

  fireEvent.click(screen.getByRole("button", { name: "마지막 반복 일정 삭제" }));
  fireEvent.click(await screen.findByRole("button", { name: "마지막 반복 일정 삭제 확인" }));

  await vi.waitFor(() => expect(client.api.delete).toHaveBeenCalledWith("/api/teacher/events/event-101"));
  expect(await screen.findByText("이전 페이지 일정")).toBeInTheDocument();
  expect(client.api.get).toHaveBeenLastCalledWith("/api/teacher/events?page=1&page_size=100");
  expect(screen.getByRole("status")).toHaveTextContent("일정 전체를 삭제했습니다.");
  expect(screen.getByRole("heading", { name: "등록된 일정" })).toHaveFocus();
  expect(screen.queryByRole("button", { name: "마지막 반복 일정 삭제" })).not.toBeInTheDocument();
});

it("preserves an event and restores deletion controls when deletion fails", async () => {
  client.api.get.mockResolvedValue(page([series()]));
  client.api.delete.mockRejectedValue(
    new client.ApiClientError("DELETE_FAILED", "일정을 삭제하지 못했습니다."),
  );
  render(<TeacherEventsPage />);
  await screen.findByText("주일예배");

  fireEvent.click(screen.getByRole("button", { name: "주일예배 삭제" }));
  fireEvent.click(await screen.findByRole("button", { name: "주일예배 삭제 확인" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("일정을 삭제하지 못했습니다.");
  expect(screen.getByText("주일예배")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "주일예배 삭제" })).toBeEnabled();
  expect(client.api.get).toHaveBeenCalledTimes(1);
});

it("refreshes the active page once after create and update successes", async () => {
  client.api.get
    .mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(page([series({ title: "새 일정" })]))
    .mockResolvedValueOnce(page([series({ title: "수정 일정" })]));
  client.api.post.mockResolvedValue(series({ title: "새 일정" }));
  client.api.patch.mockResolvedValue(series({ title: "수정 일정" }));
  render(<TeacherEventsPage />);
  await screen.findByText("등록된 일정이 없습니다.");

  fireEvent.change(screen.getByLabelText("제목"), { target: { value: "새 일정" } });
  fireEvent.change(screen.getByLabelText("시작"), { target: { value: "2026-08-23T11:00" } });
  fireEvent.change(screen.getByLabelText("종료"), { target: { value: "2026-08-23T12:00" } });
  fireEvent.click(screen.getByRole("button", { name: "일정 저장" }));

  expect(await screen.findByText("새 일정")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("일정을 등록했습니다.");
  expect(client.api.post).toHaveBeenCalledTimes(1);
  expect(client.api.get).toHaveBeenCalledTimes(2);

  fireEvent.click(screen.getByRole("button", { name: "새 일정 수정" }));
  fireEvent.change(screen.getByLabelText("제목"), { target: { value: "수정 일정" } });
  fireEvent.click(screen.getByRole("button", { name: "일정 저장" }));

  expect(await screen.findByText("수정 일정")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("일정 전체를 수정했습니다.");
  expect(client.api.patch).toHaveBeenCalledTimes(1);
  expect(client.api.get).toHaveBeenCalledTimes(3);
});

it("locks every competing manager action until a pending edit succeeds", async () => {
  let resolveUpdate: (value: ReturnType<typeof series>) => void = () => undefined;
  client.api.get
    .mockResolvedValueOnce(page([
      series({ id: "event-a", title: "수정 중 일정" }),
      series({ id: "event-b", title: "다른 일정" }),
    ], { total: 101 }))
    .mockResolvedValueOnce(page([series({ id: "event-a", title: "수정 완료 일정" })]));
  client.api.patch.mockImplementation(() => new Promise((resolve) => { resolveUpdate = resolve; }));
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  render(<TeacherEventsPage />);
  await screen.findByText("수정 중 일정");

  fireEvent.click(screen.getByRole("button", { name: "수정 중 일정 수정" }));
  fireEvent.change(screen.getByLabelText("제목"), { target: { value: "수정 완료 일정" } });
  fireEvent.click(screen.getByRole("button", { name: "일정 저장" }));
  await vi.waitFor(() => expect(client.api.patch).toHaveBeenCalledTimes(1));

  expect(screen.getByRole("button", { name: "새로고침" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "다른 일정 수정" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "다른 일정 삭제" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "다음 페이지" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "수정 취소" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "다른 일정 수정" }));
  expect(screen.getByRole("heading", { name: "일정 수정" })).toBeInTheDocument();
  expect(screen.getByLabelText("제목")).toHaveValue("수정 완료 일정");

  await act(async () => {
    resolveUpdate(series({ id: "event-a", title: "수정 완료 일정" }));
    await Promise.resolve();
  });
  expect(await screen.findByText("수정 완료 일정")).toBeInTheDocument();
  expect(client.api.patch).toHaveBeenCalledTimes(1);
  expect(client.api.get).toHaveBeenCalledTimes(2);
});

it("keeps a late mutation failure visible because competing form replacement stays locked", async () => {
  let rejectCreate: (error: Error) => void = () => undefined;
  client.api.get.mockResolvedValue(page([series({ title: "교체 대상 일정" })], { total: 101 }));
  client.api.post.mockImplementation(() => new Promise((_, reject) => { rejectCreate = reject; }));
  render(<TeacherEventsPage />);
  await screen.findByText("교체 대상 일정");

  fireEvent.change(screen.getByLabelText("제목"), { target: { value: "실패 보존 일정" } });
  fireEvent.change(screen.getByLabelText("시작"), { target: { value: "2026-08-23T11:00" } });
  fireEvent.change(screen.getByLabelText("종료"), { target: { value: "2026-08-23T12:00" } });
  fireEvent.click(screen.getByRole("button", { name: "일정 저장" }));
  await vi.waitFor(() => expect(client.api.post).toHaveBeenCalledTimes(1));

  expect(screen.getByRole("button", { name: "교체 대상 일정 수정" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "교체 대상 일정 수정" }));
  expect(screen.getByRole("heading", { name: "새 일정 등록" })).toBeInTheDocument();

  await act(async () => {
    rejectCreate(new client.ApiClientError("REQUEST_FAILED", "등록 실패를 확인해 주세요."));
    await Promise.resolve();
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("등록 실패를 확인해 주세요.");
  expect(screen.getByLabelText("제목")).toHaveValue("실패 보존 일정");
  expect(screen.getByRole("button", { name: "교체 대상 일정 수정" })).toBeEnabled();
});

it("keeps mutation authorization terminal when an older list succeeds later", async () => {
  let resolveList: (value: ReturnType<typeof page>) => void = () => undefined;
  let rejectCreate: (error: Error) => void = () => undefined;
  client.api.get.mockImplementation(() => new Promise((resolve) => { resolveList = resolve; }));
  client.api.post.mockImplementation(() => new Promise((_, reject) => { rejectCreate = reject; }));
  render(<TeacherEventsPage />);

  fireEvent.change(screen.getByLabelText("제목"), { target: { value: "인증 만료 일정" } });
  fireEvent.change(screen.getByLabelText("시작"), { target: { value: "2026-08-23T11:00" } });
  fireEvent.change(screen.getByLabelText("종료"), { target: { value: "2026-08-23T12:00" } });
  fireEvent.click(screen.getByRole("button", { name: "일정 저장" }));
  await vi.waitFor(() => expect(client.api.post).toHaveBeenCalledTimes(1));

  await act(async () => {
    rejectCreate(new client.ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."));
    await Promise.resolve();
  });
  expect(navigation.replace).toHaveBeenCalledWith("/teacher/login");

  await act(async () => {
    resolveList(page([series({ title: "늦게 도착한 보호 데이터" })]));
    await Promise.resolve();
  });
  expect(navigation.replace).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "일정 관리" })).not.toBeInTheDocument());
  expect(screen.queryByText("늦게 도착한 보호 데이터")).not.toBeInTheDocument();
});

it("ignores a late mutation success after list authorization becomes terminal", async () => {
  let rejectList: (error: Error) => void = () => undefined;
  let resolveCreate: (value: ReturnType<typeof series>) => void = () => undefined;
  client.api.get.mockImplementation(() => new Promise((_, reject) => { rejectList = reject; }));
  client.api.post.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
  render(<TeacherEventsPage />);

  fireEvent.change(screen.getByLabelText("제목"), { target: { value: "늦은 성공 일정" } });
  fireEvent.change(screen.getByLabelText("시작"), { target: { value: "2026-08-23T11:00" } });
  fireEvent.change(screen.getByLabelText("종료"), { target: { value: "2026-08-23T12:00" } });
  fireEvent.click(screen.getByRole("button", { name: "일정 저장" }));
  await vi.waitFor(() => expect(client.api.post).toHaveBeenCalledTimes(1));

  await act(async () => {
    rejectList(new client.ApiClientError("FORBIDDEN", "교사 권한이 필요합니다."));
    await Promise.resolve();
  });
  expect(navigation.replace).toHaveBeenCalledWith("/teacher/apply");

  await act(async () => {
    resolveCreate(series({ title: "늦은 성공 일정" }));
    await Promise.resolve();
  });
  expect(navigation.replace).toHaveBeenCalledTimes(1);
  expect(client.api.get).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(screen.queryByRole("heading", { name: "일정 관리" })).not.toBeInTheDocument());
  expect(screen.queryByText("일정을 등록했습니다.")).not.toBeInTheDocument();
});
