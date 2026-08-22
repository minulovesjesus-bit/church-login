import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
const TestApiClientError = vi.hoisted(() => class extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
});
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/lib/api/client", () => ({ api: mockApi, ApiClientError: TestApiClientError }));

import TeacherPage from "./page";

const recent = {
  id: "00000000-0000-4000-8000-000000000721",
  student_id: "00000000-0000-4000-8000-000000000102",
  attendance_date: "2026-08-22",
  direction: "IN",
  scanned_at: "2026-08-22T00:15:00Z",
  source: "MANUAL",
  recorded_by: "00000000-0000-4000-8000-000000000201",
  voided_at: "2026-08-22T00:20:00Z",
  voided_by: "00000000-0000-4000-8000-000000000201",
  void_reason: "중복 기록",
  student_name: "통계 제외 학생",
  student_email: "excluded@example.test",
  excluded_from_statistics: true,
};

const dashboard = {
  today_attendees: 4,
  currently_inside: 3,
  week_attendees: 8,
  statistics_target_students: 23,
  recent_attendance: [recent],
  as_of_date: "2026-08-22",
  timezone: "Asia/Seoul",
};

afterEach(() => {
  navigation.replace.mockReset();
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

it("loads only the combined dashboard endpoint immediately and renders its summary", async () => {
  mockApi.get.mockResolvedValue(dashboard);

  render(<TeacherPage />);

  expect(screen.getByRole("status")).toHaveTextContent("대시보드를 불러오고 있습니다");
  expect(await screen.findByRole("heading", { name: "교사 대시보드" })).toBeInTheDocument();
  expect(mockApi.get).toHaveBeenCalledTimes(1);
  expect(mockApi.get).toHaveBeenCalledWith("/api/teacher/dashboard", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  const metrics = screen.getByRole("group", { name: "출결 요약" });
  ([
    ["오늘 출석", "4명"],
    ["현재 입실", "3명"],
    ["이번 주", "8명"],
    ["통계 대상", "23명"],
  ] as const).forEach(([label, value]) => {
    const term = within(metrics).getByText(label);
    const metric = term.closest("div");
    expect(metric, `${label} metric container`).not.toBeNull();
    expect(within(metric!).getByLabelText(value)).toBeInTheDocument();
  });
  expect(screen.queryByText("Attendance overview")).not.toBeInTheDocument();
  expect(screen.queryByText("Recent attendance")).not.toBeInTheDocument();
});

it("renders equivalent desktop rows and mobile cards without student numbers or add controls", async () => {
  mockApi.get.mockResolvedValue(dashboard);
  render(<TeacherPage />);

  const table = await screen.findByRole("table", { name: "출결 상세 기록" });
  const cards = screen.getByRole("list", { name: "출결 기록 목록" });
  expect(within(table).getByText("통계 제외 학생")).toBeInTheDocument();
  expect(within(cards).getByText("통계 제외 학생")).toBeInTheDocument();
  expect(screen.getAllByText("통계 제외")).toHaveLength(2);
  expect(screen.getAllByText("수동 기록")).toHaveLength(2);
  expect(screen.getAllByText("취소된 원본")).toHaveLength(2);
  expect(screen.getAllByText(/오전 9:15/).length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText(/학생 번호/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /학생 추가/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /학생 추가/ })).not.toBeInTheDocument();
});

it("shows empty and retryable initial-error states", async () => {
  mockApi.get
    .mockRejectedValueOnce(new TestApiClientError("REQUEST_FAILED", "대시보드를 불러오지 못했습니다."))
    .mockResolvedValueOnce({ ...dashboard, recent_attendance: [] });
  render(<TeacherPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("대시보드를 불러오지 못했습니다.");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByText("아직 출결 기록이 없습니다.")).toBeInTheDocument();
});

it("retains the last successful dashboard and marks it stale after a refresh failure", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockApi.get
    .mockResolvedValueOnce(dashboard)
    .mockRejectedValueOnce(new TestApiClientError("REQUEST_FAILED", "새로고침 실패"));
  render(<TeacherPage />);
  expect(await screen.findByText("오늘 출석")).toBeInTheDocument();

  await act(async () => vi.advanceTimersByTimeAsync(30_000));

  expect(await screen.findByRole("alert")).toHaveTextContent("마지막으로 확인된 정보");
  expect(screen.getByText("오늘 출석")).toBeInTheDocument();
});

it.each([
  ["AUTH_REQUIRED", "/teacher/login"],
  ["FORBIDDEN", "/teacher/apply"],
])("treats %s as terminal and redirects once", async (code, destination) => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockApi.get.mockRejectedValue(new TestApiClientError(code, "권한 없음"));
  render(<TeacherPage />);

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(navigation.replace).toHaveBeenCalledWith(destination);
  await act(async () => vi.advanceTimersByTimeAsync(600_000));
  expect(navigation.replace).toHaveBeenCalledTimes(1);
  expect(mockApi.get).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("heading", { name: "교사 대시보드" })).not.toBeInTheDocument();
});
