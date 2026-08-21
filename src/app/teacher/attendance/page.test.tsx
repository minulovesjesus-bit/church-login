import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: "date_from=2026-08-01&date_to=2026-08-21&status=ALL&page=1",
  router: undefined as unknown as { replace: ReturnType<typeof vi.fn> },
}));
navigation.router = { replace: navigation.replace };
const client = vi.hoisted(() => {
  class TestApiClientError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { api: { get: vi.fn(), post: vi.fn() }, ApiClientError: TestApiClientError };
});

vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("@/lib/api/client", () => client);
vi.mock("next/dynamic", () => ({
  default: () => function ChartStub() {
    return <div role="img" aria-label="시간대별 입실 차트">차트</div>;
  },
}));

import TeacherAttendancePage from "./page";

const history = {
  items: [
    {
      id: "00000000-0000-4000-8000-000000000721",
      student_id: "00000000-0000-4000-8000-000000000102",
      attendance_date: "2026-08-21",
      direction: "IN",
      scanned_at: "2026-08-21T00:15:00Z",
      source: "QR",
      recorded_by: null,
      voided_at: null,
      voided_by: null,
      void_reason: null,
      student_name: "통계 제외 학생",
      student_email: "excluded@example.test",
      excluded_from_statistics: true,
    },
    {
      id: "00000000-0000-4000-8000-000000000722",
      student_id: "00000000-0000-4000-8000-000000000103",
      attendance_date: "2026-08-20",
      direction: "OUT",
      scanned_at: "2026-08-20T04:00:00Z",
      source: "MANUAL",
      recorded_by: "00000000-0000-4000-8000-000000000202",
      voided_at: "2026-08-20T05:00:00Z",
      voided_by: "00000000-0000-4000-8000-000000000202",
      void_reason: "중복 기록",
      student_name: "수동 기록 학생",
      student_email: "manual@example.test",
      excluded_from_statistics: false,
    },
  ],
  total: 31,
  page: 1,
  page_size: 20,
  timezone: "Asia/Seoul",
};

const statistics = {
  unique_students_today: 4,
  unique_students_this_week: 8,
  unique_students_this_month: 12,
  currently_inside: 3,
  average_stay_seconds: 4_500,
  time_of_day_entries: [{ hour: 9, entries: 4 }],
  student_attendance_days: [{ student_id: "00000000-0000-4000-8000-000000000104", student_name: "포함 학생", attendance_days: 3 }],
  student_attendance_days_total: 1,
  student_attendance_days_page: 1,
  student_attendance_days_page_size: 20,
  date_from: "2026-08-01",
  date_to: "2026-08-21",
  as_of_date: "2026-08-21",
  timezone: "Asia/Seoul",
};

function resolveTeacherApi(path: string) {
  if (path.startsWith("/api/teacher/attendance?")) return Promise.resolve(history);
  if (path.startsWith("/api/teacher/statistics?")) return Promise.resolve(statistics);
  throw new Error(`Unexpected path: ${path}`);
}

afterEach(() => {
  client.api.get.mockReset();
  client.api.post.mockReset();
  navigation.replace.mockReset();
  navigation.search = "date_from=2026-08-01&date_to=2026-08-21&status=ALL&page=1";
});

it("keeps excluded students visible and distinguishes manual and voided originals", async () => {
  client.api.get.mockImplementation(resolveTeacherApi);

  render(<TeacherAttendancePage />);

  expect(screen.getByRole("status")).toHaveTextContent("전체 출결을 불러오고 있어요");
  expect(await screen.findByRole("heading", { name: "전체 출결 관리" })).toBeInTheDocument();
  const mobileTimeline = screen.getByRole("list", { name: "출결 기록 목록" });
  expect(within(mobileTimeline).getAllByRole("listitem")).toHaveLength(2);
  expect(within(mobileTimeline).getAllByRole("button", { name: "상세 및 보정" })).toHaveLength(2);
  expect(screen.getAllByText("통계 제외 학생").length).toBeGreaterThan(0);
  expect(screen.getAllByText("통계 제외").length).toBeGreaterThan(0);
  expect(screen.getAllByText("수동 기록").length).toBeGreaterThan(0);
  expect(screen.getAllByText("취소된 원본").length).toBeGreaterThan(0);
  expect(screen.getByText("오늘 4명")).toBeInTheDocument();
  expect(screen.getByText("현재 입실 3명")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "시간대별 입실 차트" })).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "시간대별 입실 데이터" })).toBeInTheDocument();
  expect(screen.queryByLabelText(/학생.*번호/i)).not.toBeInTheDocument();
});

it("writes bounded date, status, and search filters to the URL", async () => {
  client.api.get.mockImplementation(resolveTeacherApi);
  render(<TeacherAttendancePage />);
  await screen.findByRole("heading", { name: "전체 출결 관리" });

  fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-08-10" } });
  fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-08-21" } });
  fireEvent.change(screen.getByLabelText("출결 상태"), { target: { value: "VOIDED" } });
  fireEvent.change(screen.getByLabelText("학생 검색"), { target: { value: " 김 학생 " } });
  fireEvent.submit(screen.getByRole("form", { name: "출결 필터" }));

  expect(navigation.replace).toHaveBeenCalledTimes(1);
  const destination = navigation.replace.mock.calls[0][0] as string;
  expect(destination).toContain("date_from=2026-08-10");
  expect(destination).toContain("date_to=2026-08-21");
  expect(destination).toContain("status=VOIDED");
  expect(destination).toContain("search=%EA%B9%80+%ED%95%99%EC%83%9D");
  expect(destination).toContain("page=1");
  expect(destination).not.toContain("student_id");
});

it("uses URL pagination totals and preserves active filters", async () => {
  client.api.get.mockImplementation(resolveTeacherApi);
  render(<TeacherAttendancePage />);

  fireEvent.click(await screen.findByRole("button", { name: "다음 페이지" }));

  expect(navigation.replace).toHaveBeenCalledWith(expect.stringContaining("page=2"));
  expect(navigation.replace).toHaveBeenCalledWith(expect.stringContaining("status=ALL"));
  expect(screen.getByText("1 / 2 페이지 · 총 31건")).toBeInTheDocument();
});

it("shows empty and retryable error states without unbounded requests", async () => {
  client.api.get
    .mockRejectedValueOnce(new client.ApiClientError("REQUEST_FAILED", "출결을 불러오지 못했습니다."))
    .mockRejectedValueOnce(new client.ApiClientError("REQUEST_FAILED", "출결을 불러오지 못했습니다."));
  render(<TeacherAttendancePage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("출결을 불러오지 못했습니다.");

  client.api.get.mockImplementation((path: string) => path.startsWith("/api/teacher/attendance?")
    ? Promise.resolve({ ...history, items: [], total: 0 })
    : Promise.resolve({ ...statistics, time_of_day_entries: [], student_attendance_days: [], student_attendance_days_total: 0 }));
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

  expect(await screen.findByText("조건에 맞는 출결 기록이 없어요.")).toBeInTheDocument();
  expect(client.api.get.mock.calls.flat().join(" ")).toContain("page_size=20");
  expect(client.api.get.mock.calls.flat().join(" ")).not.toContain("page_size=1000");
});

it("requires a correction reason, submits a void, and preserves the original row", async () => {
  client.api.get.mockImplementation(resolveTeacherApi);
  client.api.post.mockResolvedValue({ ...history.items[0], voided_at: "2026-08-21T01:00:00Z", void_reason: "중복 스캔" });
  render(<TeacherAttendancePage />);

  const row = (await screen.findAllByText("excluded@example.test")).map((element) => element.closest("tr")).find(Boolean);
  expect(row).not.toBeNull();
  fireEvent.click(within(row!).getByRole("button", { name: "상세 및 보정" }));

  fireEvent.click(screen.getByRole("button", { name: "원본 기록 취소" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("보정 사유를 입력해 주세요.");
  expect(client.api.post).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("보정 사유"), { target: { value: "  중복 스캔  " } });
  fireEvent.click(screen.getByRole("button", { name: "원본 기록 취소" }));

  await vi.waitFor(() => expect(client.api.post).toHaveBeenCalledWith(
    "/api/teacher/attendance/corrections",
    { mode: "VOID", scan_id: history.items[0].id, reason: "중복 스캔" },
  ));
  expect(await screen.findByRole("status")).toHaveTextContent("보정이 저장되었습니다.");
  expect(screen.getAllByText("통계 제외 학생").length).toBeGreaterThan(0);
});

it("appends a timezone-aware manual record for the selected student", async () => {
  client.api.get.mockImplementation(resolveTeacherApi);
  client.api.post.mockResolvedValue({ ...history.items[0], id: "00000000-0000-4000-8000-000000000799", source: "MANUAL" });
  render(<TeacherAttendancePage />);

  const row = (await screen.findAllByText("excluded@example.test")).map((element) => element.closest("tr")).find(Boolean);
  fireEvent.click(within(row!).getByRole("button", { name: "상세 및 보정" }));
  fireEvent.change(screen.getByLabelText("수동 출결 방향"), { target: { value: "OUT" } });
  fireEvent.change(screen.getByLabelText("수동 출결 시각"), { target: { value: "2026-08-21T18:30" } });
  fireEvent.change(screen.getByLabelText("보정 사유"), { target: { value: "퇴실 누락" } });
  fireEvent.click(screen.getByRole("button", { name: "수동 기록 추가" }));

  await vi.waitFor(() => expect(client.api.post).toHaveBeenCalledWith(
    "/api/teacher/attendance/corrections",
    {
      mode: "MANUAL",
      student_id: history.items[0].student_id,
      direction: "OUT",
      scanned_at: "2026-08-21T09:30:00.000Z",
      reason: "퇴실 누락",
    },
  ));
});

it("keeps the original visible when a correction request fails safely", async () => {
  client.api.get.mockImplementation(resolveTeacherApi);
  client.api.post.mockRejectedValue(
    new client.ApiClientError("CORRECTION_FAILED", "보정을 저장하지 못했습니다."),
  );
  render(<TeacherAttendancePage />);

  const row = (await screen.findAllByText("excluded@example.test"))
    .map((element) => element.closest("tr"))
    .find(Boolean);
  fireEvent.click(within(row!).getByRole("button", { name: "상세 및 보정" }));
  fireEvent.change(screen.getByLabelText("보정 사유"), { target: { value: "확인 필요" } });
  fireEvent.click(screen.getByRole("button", { name: "원본 기록 취소" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("보정을 저장하지 못했습니다.");
  expect(screen.getAllByText("통계 제외 학생").length).toBeGreaterThan(0);
});

it("redirects an expired teacher session without attendance content", async () => {
  client.api.get.mockRejectedValue(
    new client.ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."),
  );
  render(<TeacherAttendancePage />);

  await vi.waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/teacher/login"));
  expect(screen.queryByRole("heading", { name: "전체 출결 관리" })).not.toBeInTheDocument();
});
