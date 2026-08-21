import { fireEvent, render, screen, within } from "@testing-library/react";
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
  return { api: { get: vi.fn() }, ApiClientError: TestApiClientError };
});

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/lib/api/client", () => client);

import StudentAttendancePage from "./page";

const summary = {
  attendance_days_this_week: 2,
  attendance_days_this_month: 5,
  total_entries: 7,
  average_stay_seconds: 5_400,
  currently_inside: true,
  open_stay_started_at: "2026-08-21T00:15:00Z",
  as_of_date: "2026-08-21",
  timezone: "Asia/Seoul",
};

const history = {
  items: [
    {
      id: "00000000-0000-4000-8000-000000000711",
      student_id: "00000000-0000-4000-8000-000000000102",
      attendance_date: "2026-08-21",
      direction: "IN",
      scanned_at: "2026-08-21T00:15:00Z",
      source: "QR",
      recorded_by: null,
      voided_at: null,
      voided_by: null,
      void_reason: null,
    },
    {
      id: "00000000-0000-4000-8000-000000000710",
      student_id: "00000000-0000-4000-8000-000000000102",
      attendance_date: "2026-08-20",
      direction: "OUT",
      scanned_at: "2026-08-20T03:00:00Z",
      source: "MANUAL",
      recorded_by: "00000000-0000-4000-8000-000000000202",
      voided_at: "2026-08-20T04:00:00Z",
      voided_by: "00000000-0000-4000-8000-000000000202",
      void_reason: "잘못 추가된 기록",
    },
  ],
  total: 32,
  page: 1,
  page_size: 20,
  timezone: "Asia/Seoul",
};

function resolveStudentApi(path: string) {
  if (path === "/api/statistics/me") return Promise.resolve(summary);
  if (path === "/api/attendance/me?page=1&page_size=20") return Promise.resolve(history);
  throw new Error(`Unexpected path: ${path}`);
}

afterEach(() => {
  client.api.get.mockReset();
  navigation.replace.mockReset();
});

it("renders personal totals, the open stay, and recent records in Seoul time", async () => {
  client.api.get.mockImplementation(resolveStudentApi);

  render(<StudentAttendancePage />);

  expect(screen.getByRole("status")).toHaveTextContent("출결 기록을 불러오고 있어요");
  expect(await screen.findByRole("heading", { name: "내 출결 기록" })).toBeInTheDocument();
  expect(screen.getByText("이번 주 2일")).toBeInTheDocument();
  expect(screen.getByText("이번 달 5일")).toBeInTheDocument();
  expect(screen.getByText("총 입실 7회")).toBeInTheDocument();
  expect(screen.getByText("평균 체류 1시간 30분")).toBeInTheDocument();
  expect(screen.getByText("현재 입실 중")).toBeInTheDocument();
  expect(screen.getAllByText(/오전 9:15/).length).toBeGreaterThan(0);

  const recent = screen.getByRole("region", { name: "최근 출결" });
  const mobileTimeline = screen.getByRole("list", { name: "출결 기록 목록" });
  expect(within(mobileTimeline).getAllByRole("listitem")).toHaveLength(2);
  expect(within(recent).getAllByText("입실").length).toBeGreaterThan(0);
  expect(within(recent).getAllByText("수동 기록").length).toBeGreaterThan(0);
  expect(within(recent).getAllByText("취소된 원본").length).toBeGreaterThan(0);
  expect(screen.queryByLabelText(/학생.*번호/i)).not.toBeInTheDocument();
  expect(client.api.get.mock.calls.flat().join(" ")).not.toContain("student_id");
});

it("renders an accessible empty state", async () => {
  client.api.get.mockImplementation((path: string) => {
    if (path === "/api/statistics/me") {
      return Promise.resolve({ ...summary, attendance_days_this_week: 0, attendance_days_this_month: 0, total_entries: 0, average_stay_seconds: null, currently_inside: false, open_stay_started_at: null });
    }
    return Promise.resolve({ ...history, items: [], total: 0 });
  });

  render(<StudentAttendancePage />);

  expect(await screen.findByText("아직 출결 기록이 없어요.")).toBeInTheDocument();
  expect(screen.getByText("현재 퇴실 상태")).toBeInTheDocument();
  expect(screen.getByText("평균 체류 기록 없음")).toBeInTheDocument();
});

it("shows a retryable error and refetches both bounded endpoints", async () => {
  client.api.get
    .mockRejectedValueOnce(new client.ApiClientError("REQUEST_FAILED", "잠시 후 다시 시도해 주세요."))
    .mockRejectedValueOnce(new client.ApiClientError("REQUEST_FAILED", "잠시 후 다시 시도해 주세요."))
    .mockImplementation(resolveStudentApi);

  render(<StudentAttendancePage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

  expect(await screen.findByRole("heading", { name: "내 출결 기록" })).toBeInTheDocument();
  expect(client.api.get).toHaveBeenCalledWith("/api/attendance/me?page=1&page_size=20");
});

it("redirects an expired student session without rendering attendance data", async () => {
  client.api.get.mockRejectedValue(new client.ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."));

  render(<StudentAttendancePage />);

  await vi.waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/auth/login"));
  expect(screen.queryByRole("heading", { name: "내 출결 기록" })).not.toBeInTheDocument();
});

it("uses bounded pagination for older personal records", async () => {
  client.api.get.mockImplementation((path: string) => {
    if (path === "/api/statistics/me") return Promise.resolve(summary);
    if (path === "/api/attendance/me?page=1&page_size=20") return Promise.resolve(history);
    if (path === "/api/attendance/me?page=2&page_size=20") {
      return Promise.resolve({ ...history, items: [], page: 2 });
    }
    throw new Error(`Unexpected path: ${path}`);
  });

  render(<StudentAttendancePage />);
  fireEvent.click(await screen.findByRole("button", { name: "다음 페이지" }));

  await vi.waitFor(() => expect(client.api.get).toHaveBeenCalledWith("/api/attendance/me?page=2&page_size=20"));
  await vi.waitFor(() => expect(screen.getByText((_, element) => element?.textContent === "2 / 2 페이지")).toBeInTheDocument());
});
