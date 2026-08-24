import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const signOut = vi.hoisted(() => vi.fn());
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

vi.mock("@/lib/api/client", () => client);
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({ auth: { signOut } }),
}));

import StudentPage from "./page";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const validMe = {
  email: "student@example.com",
  onboarding_completed: true,
  capabilities: { student: true, teacher: false, admin: false },
};
const newStudentMe = {
  email: "new-student@example.com",
  onboarding_completed: false,
  capabilities: { student: false, teacher: false, admin: false },
};
const studentStatistics = {
  attendance_days_this_week: 2,
  attendance_days_this_month: 5,
  total_entries: 7,
  average_stay_seconds: 5_400,
  currently_inside: true,
  open_stay_started_at: "2026-08-22T00:15:00Z",
  as_of_date: "2026-08-22",
  timezone: "Asia/Seoul",
};
const studentProfile = {
  name: "김민준",
  birth_date: "2012-04-03",
  phone: "01012345678",
  guardian_phone: "01098765432",
  include_in_statistics: true,
};

afterEach(() => {
  router.replace.mockReset();
  client.api.get.mockReset();
  signOut.mockReset();
  vi.useRealTimers();
});

it("redirects a new student to onboarding", async () => {
  client.api.get.mockResolvedValue(newStudentMe);
  render(<StudentPage />);

  await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/onboarding"));
});

it("prioritizes incomplete student identity over an earlier temporary statistics failure", async () => {
  const me = deferred<typeof validMe>();
  const statistics = deferred<typeof studentStatistics>();
  client.api.get.mockImplementation((path: string) => path === "/api/me" ? me.promise : statistics.promise);
  render(<StudentPage />);

  await act(async () => statistics.reject(new client.ApiClientError("REQUEST_FAILED", "통계 일시 실패")));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(router.replace).not.toHaveBeenCalled();

  await act(async () => me.resolve(newStudentMe));
  await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/onboarding"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("prioritizes a late authentication failure over an earlier temporary statistics failure", async () => {
  const me = deferred<typeof validMe>();
  const statistics = deferred<typeof studentStatistics>();
  client.api.get.mockImplementation((path: string) => path === "/api/me" ? me.promise : statistics.promise);
  render(<StudentPage />);

  await act(async () => statistics.reject(new client.ApiClientError("REQUEST_FAILED", "통계 일시 실패")));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => me.reject(new client.ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다.")));

  await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("prioritizes a statistics profile requirement over a temporary identity failure", async () => {
  const me = deferred<typeof validMe>();
  const statistics = deferred<typeof studentStatistics>();
  client.api.get.mockImplementation((path: string) => path === "/api/me" ? me.promise : statistics.promise);
  render(<StudentPage />);

  await act(async () => me.reject(new client.ApiClientError("REQUEST_FAILED", "사용자 일시 실패")));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => statistics.reject(new client.ApiClientError("PROFILE_REQUIRED", "프로필이 필요합니다.")));

  await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/onboarding"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("redirects when valid identity and statistics reports a profile requirement", async () => {
  const me = deferred<typeof validMe>();
  const statistics = deferred<typeof studentStatistics>();
  client.api.get.mockImplementation((path: string) => path === "/api/me" ? me.promise : statistics.promise);
  render(<StudentPage />);

  await act(async () => me.resolve(validMe));
  expect(router.replace).not.toHaveBeenCalled();
  await act(async () => statistics.reject(new client.ApiClientError("PROFILE_REQUIRED", "프로필이 필요합니다.")));

  await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/onboarding"));
});

it("shows the student home for a returning student", async () => {
  client.api.get.mockImplementation((path: string) => {
    if (path === "/api/me") return Promise.resolve(validMe);
    if (path === "/api/statistics/me") return Promise.resolve(studentStatistics);
    if (path === "/api/students/profile") return Promise.resolve(studentProfile);
    if (path.startsWith("/api/events?")) return Promise.resolve([]);
    throw new Error(`Unexpected path: ${path}`);
  });
  render(<StudentPage />);

  expect(await screen.findByRole("heading", { name: "반가워요!" })).toBeInTheDocument();
  expect(await screen.findByText("이번 주 등록된 일정이 없습니다.")).toBeInTheDocument();
  const events = await screen.findByRole("heading", { name: "이번 주 일정" });
  const account = await screen.findByRole("heading", { name: "내 정보" });
  expect(events.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("student@example.com")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "교사 화면 보기" })).not.toBeInTheDocument();
  expect(router.replace).not.toHaveBeenCalled();
});

it("does not render a Home-header teacher action for a staff student", async () => {
  const teacherMe = {
    email: "staff@example.com",
    onboarding_completed: true,
    capabilities: { student: true, teacher: true, admin: false },
  };
  client.api.get.mockImplementation((path: string) => {
    if (path === "/api/me") return Promise.resolve(teacherMe);
    if (path === "/api/statistics/me") return Promise.resolve(studentStatistics);
    if (path === "/api/students/profile") return Promise.resolve(studentProfile);
    if (path.startsWith("/api/events?")) return Promise.resolve([]);
    throw new Error(`Unexpected path: ${path}`);
  });

  render(<StudentPage />);

  expect(await screen.findByRole("heading", { name: "내 정보" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "교사 화면 보기" })).not.toBeInTheDocument();
});

it("redirects to login only when authentication is required", async () => {
  client.api.get.mockRejectedValue(new client.ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."));
  render(<StudentPage />);

  await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
});

it("shows a retryable error for a temporary API failure", async () => {
  client.api.get.mockRejectedValue(new client.ApiClientError("REQUEST_FAILED", "잠시 후 다시 시도해 주세요."));
  render(<StudentPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
  expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  expect(router.replace).not.toHaveBeenCalled();
});

it("retries a temporary API failure", async () => {
  let failed = false;
  client.api.get.mockImplementation((path: string) => {
    if (!failed) {
      failed = true;
      return Promise.reject(new client.ApiClientError("REQUEST_FAILED", "잠시 후 다시 시도해 주세요."));
    }
    if (path === "/api/me") return Promise.resolve(validMe);
    if (path === "/api/statistics/me") return Promise.resolve(studentStatistics);
    if (path === "/api/students/profile") return Promise.resolve(studentProfile);
    if (path.startsWith("/api/events?")) return Promise.resolve([]);
    throw new Error(`Unexpected path: ${path}`);
  });
  render(<StudentPage />);

  fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));

  expect(await screen.findByRole("heading", { name: "반가워요!" })).toBeInTheDocument();
  expect(await screen.findByText("이번 주 등록된 일정이 없습니다.")).toBeInTheDocument();
});

it("shows only ongoing or upcoming current-week occurrences below the existing attendance content", async () => {
  client.api.get.mockImplementation((path: string) => {
    if (path === "/api/me") return Promise.resolve(validMe);
    if (path === "/api/statistics/me") return Promise.resolve(studentStatistics);
    if (path === "/api/students/profile") return Promise.resolve(studentProfile);
    if (path === "/api/events?from=2026-08-17&to=2026-08-24") {
      return Promise.resolve([
        { occurrence_id: "future:2026-08-22", event_id: "future", title: "나중 일정", description: null, local_start: "2026-08-22T11:00:00+09:00", local_end: "2026-08-22T12:00:00+09:00", location: null },
        { occurrence_id: "finished:2026-08-17", event_id: "finished", title: "끝난 일정", description: null, local_start: "2026-08-17T11:00:00+09:00", local_end: "2026-08-17T12:00:00+09:00", location: null },
        { occurrence_id: "ongoing:2026-08-19", event_id: "ongoing", title: "진행 중 일정", description: null, local_start: "2026-08-19T11:00:00+09:00", local_end: "2026-08-19T13:00:00+09:00", location: null },
        { occurrence_id: "upcoming:2026-08-19", event_id: "upcoming", title: "곧 시작할 일정", description: null, local_start: "2026-08-19T14:00:00+09:00", local_end: "2026-08-19T15:00:00+09:00", location: null },
      ]);
    }
    throw new Error(`Unexpected path: ${path}`);
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-19T03:30:00Z"));
  render(<StudentPage />);

  const attendanceCopy = await screen.findByRole("heading", { name: "오늘 출결 상태" });
  const eventsHeading = await screen.findByRole("heading", { name: "이번 주 일정" });
  expect(attendanceCopy.compareDocumentPosition(eventsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(await screen.findByText("진행 중 일정")).toBeInTheDocument();
  expect(await screen.findByText("곧 시작할 일정")).toBeInTheDocument();
  expect(screen.queryByText("끝난 일정")).not.toBeInTheDocument();
  expect(screen.queryByText("나중 일정")).not.toBeInTheDocument();
  expect(client.api.get).toHaveBeenCalledWith("/api/events?from=2026-08-17&to=2026-08-24");
});

it("renders the QR-first student dashboard in the approved information order", async () => {
  client.api.get.mockImplementation((path: string) => {
    if (path === "/api/me") {
      return Promise.resolve(validMe);
    }
    if (path === "/api/statistics/me") {
      return Promise.resolve(studentStatistics);
    }
    if (path === "/api/students/profile") return Promise.resolve(studentProfile);
    if (path.startsWith("/api/events?")) return Promise.resolve([]);
    throw new Error(`Unexpected path: ${path}`);
  });

  render(<StudentPage />);

  const heading = await screen.findByRole("heading", { name: "반가워요!" });
  const today = screen.getByRole("heading", { name: "오늘 출결 상태" });
  const qr = screen.getByRole("link", { name: "QR로 출결하기" });
  const statistics = screen.getByRole("heading", { name: "나의 이번 달" });
  const events = screen.getByRole("heading", { name: "이번 주 일정" });
  const account = await screen.findByRole("heading", { name: "내 정보" });
  expect(heading.compareDocumentPosition(today) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(today.compareDocumentPosition(qr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(qr.compareDocumentPosition(statistics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(statistics.compareDocumentPosition(events) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(events.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(qr).toHaveAttribute("href", "/student/scan");
  expect(qr).toHaveAttribute("data-slot", "button");
  expect(screen.getAllByRole("link", { name: "QR로 출결하기" })).toHaveLength(1);
  expect(screen.queryByText(/Student home|Today|Monthly attendance|This week/i)).not.toBeInTheDocument();
  expect(screen.getByText("김민준")).toBeInTheDocument();
  expect(screen.getByText("현재 입실 중")).toBeInTheDocument();
  expect(screen.getByText("이번 달 5일")).toBeInTheDocument();
  expect(screen.getByText("총 입실 7회")).toBeInTheDocument();
  expect(screen.getByText("평균 체류 1시간 30분")).toBeInTheDocument();
  expect(await screen.findByText("이번 주 등록된 일정이 없습니다.")).toBeInTheDocument();
});

it("keeps each monthly metric as a valid description-list group without decorative siblings", async () => {
  client.api.get.mockImplementation((path: string) => {
    if (path === "/api/me") return Promise.resolve(validMe);
    if (path === "/api/statistics/me") return Promise.resolve(studentStatistics);
    if (path === "/api/students/profile") return Promise.resolve(studentProfile);
    if (path.startsWith("/api/events?")) return Promise.resolve([]);
    throw new Error(`Unexpected path: ${path}`);
  });

  render(<StudentPage />);

  const heading = await screen.findByRole("heading", { name: "나의 이번 달" });
  const metrics = heading.closest("section")?.querySelector("dl");
  expect(metrics).not.toBeNull();
  expect(metrics?.querySelector('[data-slot="separator"]')).not.toBeInTheDocument();

  const groups = Array.from(metrics?.children ?? []);
  expect(groups).toHaveLength(3);
  expect(groups.map((group) => [
    group.querySelector(":scope > dt")?.textContent,
    group.querySelector(":scope > dd")?.textContent,
  ])).toEqual([
    ["출석일", "이번 달 5일"],
    ["누적 입실", "총 입실 7회"],
    ["평균 체류", "평균 체류 1시간 30분"],
  ]);
});

it("uses shadcn feedback primitives without changing status and retry semantics", async () => {
  const me = deferred<typeof validMe>();
  const statistics = deferred<typeof studentStatistics>();
  client.api.get.mockImplementation((path: string) => path === "/api/me" ? me.promise : statistics.promise);
  const { unmount } = render(<StudentPage />);

  const loading = screen.getByRole("status");
  expect(loading).toHaveTextContent("학생 정보를 확인하고 있습니다.");
  expect(loading.querySelector('[data-slot="skeleton"]')).not.toBeNull();

  unmount();
  await act(async () => {
    me.resolve(validMe);
    statistics.resolve(studentStatistics);
  });

  client.api.get.mockRejectedValue(new client.ApiClientError("REQUEST_FAILED", "잠시 후 다시 시도해 주세요."));
  render(<StudentPage />);

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveAttribute("data-slot", "alert");
  expect(alert).toHaveTextContent("잠시 후 다시 시도해 주세요.");
  expect(screen.getByRole("button", { name: "다시 시도" })).toHaveAttribute("data-slot", "button");
});
