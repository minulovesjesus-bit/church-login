import { act, Suspense } from "react";
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

import StudentEventsPage from "./page";

const monday = "2026-08-17";
const event = (overrides: Record<string, unknown> = {}) => ({
  occurrence_id: "event-1:2026-08-17",
  event_id: "00000000-0000-4000-8000-000000000001",
  title: "새벽 기도회",
  description: "함께 기도해요",
  local_start: "2026-08-16T15:30:00Z",
  local_end: "2026-08-16T16:30:00Z",
  location: "본당",
  ...overrides,
});

async function renderPage(week: string | string[] | undefined = monday) {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(
      <Suspense fallback={<p>대기 중</p>}>
        <StudentEventsPage searchParams={Promise.resolve({ week })} />
      </Suspense>,
    );
    await Promise.resolve();
  });
  return view!;
}

afterEach(() => {
  client.api.get.mockReset();
  navigation.replace.mockReset();
  vi.useRealTimers();
});

it("groups sorted occurrences by Seoul date, including a cross-midnight event", async () => {
  client.api.get.mockResolvedValue([
    event({ occurrence_id: "late:2026-08-17", title: "밤샘 기도", local_start: "2026-08-17T14:00:00Z", local_end: "2026-08-17T16:00:00Z" }),
    event({ occurrence_id: "early:2026-08-17", title: "새벽 기도회" }),
    event({ occurrence_id: "sunday:2026-08-23", title: "주일예배", local_start: "2026-08-23T02:00:00+09:00", local_end: "2026-08-23T03:00:00+09:00" }),
  ]);

  await renderPage();

  expect(await screen.findByText("8월 17일 월요일")).toBeInTheDocument();
  expect(screen.getByText("8월 23일 일요일")).toBeInTheDocument();
  expect(client.api.get).toHaveBeenCalledWith("/api/events?from=2026-08-17&to=2026-08-24");

  const list = screen.getByRole("list", { name: "주간 일정 목록" });
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    expect.stringContaining("새벽 기도회"),
    expect.stringContaining("밤샘 기도"),
    expect.stringContaining("주일예배"),
  ]);
  expect(screen.getByText("밤샘 기도").closest("li")?.querySelector("time")?.dateTime).toBe("2026-08-17T14:00:00Z");
  expect(screen.getByText("밤샘 기도").closest("li")).toHaveTextContent("오후 11:00 – 오전 1:00");
});

it.each([
  ["2026-08-10", "2026-08-03", "2026-08-17"],
  ["2026-08-24", "2026-08-17", "2026-08-31"],
])("uses the actual current Seoul Monday for the current-week link from selected week %s", async (week, previous, next) => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-19T03:30:00Z"));
  client.api.get.mockResolvedValue([]);
  await renderPage(week);

  await screen.findByText("이번 주 등록된 일정이 없습니다.");

  expect(screen.getByRole("link", { name: "이전 주" })).toHaveAttribute("href", `/student/events?week=${previous}`);
  expect(screen.getByRole("link", { name: "이번 주" })).toHaveAttribute("href", "/student/events?week=2026-08-17");
  expect(screen.getByRole("link", { name: "다음 주" })).toHaveAttribute("href", `/student/events?week=${next}`);
});

it.each([undefined, "2026-02-30", "2026-08-18", ["2026-08-17", "2026-08-24"]])(
  "falls back to the current Seoul Monday for invalid week input %#",
  async (week) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-19T14:00:00Z"));
    client.api.get.mockResolvedValue([]);

    await renderPage(week);

    await vi.waitFor(() => expect(client.api.get).toHaveBeenCalledWith("/api/events?from=2026-08-17&to=2026-08-24"));
  },
);

it.each([
  ["0001-01-01", "/api/events?from=0001-01-01&to=0001-01-08"],
  ["0000-01-03", "/api/events?from=2026-08-17&to=2026-08-24"],
  ["9999-12-20", "/api/events?from=9999-12-20&to=9999-12-27"],
  ["9999-12-27", "/api/events?from=2026-08-17&to=2026-08-24"],
])("uses only backend-compatible week bounds for %s", async (week, expectedPath) => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-19T03:30:00Z"));
  client.api.get.mockResolvedValue([]);

  await renderPage(week);

  await vi.waitFor(() => expect(client.api.get).toHaveBeenCalledWith(expectedPath));
});

it.each([
  ["0001-01-01", "이전 주", "다음 주", "0001-01-08"],
  ["9999-12-20", "다음 주", "이전 주", "9999-12-13"],
])("does not emit an unselectable adjacent link at the %s boundary", async (week, unavailableLabel, availableLabel, availableWeek) => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-19T03:30:00Z"));
  client.api.get.mockResolvedValue([]);

  await renderPage(week);

  await screen.findByText("이번 주 등록된 일정이 없습니다.");
  expect(screen.queryByRole("link", { name: unavailableLabel })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: unavailableLabel })).toBeDisabled();
  expect(screen.getByRole("link", { name: availableLabel })).toHaveAttribute("href", `/student/events?week=${availableWeek}`);
  expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).not.toContain("/student/events?week=0000-12-25");
  expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).not.toContain("/student/events?week=9999-12-27");
});

it("keeps exact week destinations, Lucide controls, and occurrence time semantics", async () => {
  client.api.get.mockResolvedValue([event()]);

  await renderPage();
  await screen.findByText("새벽 기도회");

  expect(screen.getByRole("link", { name: "이전 주" })).toHaveAttribute("href", "/student/events?week=2026-08-10");
  expect(screen.getByRole("link", { name: "이번 주" })).toHaveAttribute("href", expect.stringMatching(/^\/student\/events\?week=\d{4}-\d{2}-\d{2}$/));
  expect(screen.getByRole("link", { name: "다음 주" })).toHaveAttribute("href", "/student/events?week=2026-08-24");
  expect(screen.getByRole("link", { name: "이전 주" }).querySelector('[data-icon="inline-start"]')).not.toBeNull();
  expect(screen.getByRole("link", { name: "다음 주" }).querySelector('[data-icon="inline-end"]')).not.toBeNull();

  const occurrence = screen.getByText("새벽 기도회").closest("li");
  expect(occurrence?.querySelector('time[datetime="2026-08-16T15:30:00Z"]')).not.toBeNull();
  expect(occurrence?.querySelector('time[datetime="2026-08-16T16:30:00Z"]')).not.toBeNull();
});

it("shows distinct loading, retryable error, retry, and auth redirect states", async () => {
  let rejectFirst: (error: Error) => void = () => undefined;
  client.api.get
    .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
    .mockResolvedValueOnce([]);

  await renderPage();

  expect(screen.getByRole("status")).toHaveTextContent("일정을 불러오고 있습니다.");
  expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  await act(async () => {
    rejectFirst(new client.ApiClientError("REQUEST_FAILED", "일정을 불러오지 못했습니다."));
    await Promise.resolve();
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("일정을 불러오지 못했습니다.");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByText("이번 주 등록된 일정이 없습니다.")).toBeInTheDocument();

  client.api.get.mockRejectedValueOnce(new client.ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."));
  renderPage("2026-08-24");
  await vi.waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/auth/login"));
});

it("ignores a stale response after week navigation and after unmount", async () => {
  let resolveFirst: (events: ReturnType<typeof event>[]) => void = () => undefined;
  client.api.get
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValueOnce([event({ occurrence_id: "new:2026-08-24", title: "다음 주 일정", local_start: "2026-08-24T02:00:00+09:00" })]);

  const view = await renderPage();
  await vi.waitFor(() => expect(client.api.get).toHaveBeenCalledTimes(1));
  await act(async () => {
    view.rerender(
      <Suspense fallback={<p>대기 중</p>}>
        <StudentEventsPage searchParams={Promise.resolve({ week: "2026-08-24" })} />
      </Suspense>,
    );
    await Promise.resolve();
  });
  expect(await screen.findByText("다음 주 일정")).toBeInTheDocument();

  resolveFirst([event({ title: "이전 주 일정" })]);
  await Promise.resolve();
  expect(screen.queryByText("이전 주 일정")).not.toBeInTheDocument();

  view.unmount();
  await Promise.resolve();
});
