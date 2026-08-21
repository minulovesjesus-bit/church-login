import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
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

import StudentPage from "./page";

afterEach(() => {
  router.replace.mockReset();
  client.api.get.mockReset();
});

it("redirects a new student to onboarding", async () => {
  client.api.get.mockResolvedValue({ onboarding_completed: false, capabilities: { student: false } });
  render(<StudentPage />);

  await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/onboarding"));
});

it("shows the student home for a returning student", async () => {
  client.api.get.mockImplementation((path: string) => path === "/api/me"
    ? Promise.resolve({ onboarding_completed: true, capabilities: { student: true } })
    : Promise.resolve([]));
  render(<StudentPage />);

  expect(await screen.findByRole("heading", { name: "학생 출결" })).toBeInTheDocument();
  expect(router.replace).not.toHaveBeenCalled();
});

it("redirects to login only when authentication is required", async () => {
  client.api.get.mockRejectedValue(new client.ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."));
  render(<StudentPage />);

  await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/auth/login"));
});

it("shows a retryable error for a temporary API failure", async () => {
  client.api.get.mockRejectedValue(new client.ApiClientError("REQUEST_FAILED", "잠시 후 다시 시도해 주세요."));
  render(<StudentPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
  expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  expect(router.replace).not.toHaveBeenCalled();
});

it("retries a temporary API failure", async () => {
  client.api.get
    .mockRejectedValueOnce(new client.ApiClientError("REQUEST_FAILED", "잠시 후 다시 시도해 주세요."))
    .mockResolvedValueOnce({ onboarding_completed: true, capabilities: { student: true } })
    .mockResolvedValueOnce([]);
  render(<StudentPage />);

  fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));

  expect(await screen.findByRole("heading", { name: "학생 출결" })).toBeInTheDocument();
});

it("shows only the next two current-week occurrences below the existing attendance content", async () => {
  client.api.get.mockImplementation((path: string) => {
    if (path === "/api/me") return Promise.resolve({ onboarding_completed: true, capabilities: { student: true } });
    if (path === "/api/events?from=2026-08-17&to=2026-08-24") {
      return Promise.resolve([
        { occurrence_id: "third:2026-08-22", event_id: "third", title: "세 번째 일정", description: null, local_start: "2026-08-22T11:00:00+09:00", local_end: "2026-08-22T12:00:00+09:00", location: null },
        { occurrence_id: "first:2026-08-17", event_id: "first", title: "첫 번째 일정", description: null, local_start: "2026-08-17T11:00:00+09:00", local_end: "2026-08-17T12:00:00+09:00", location: null },
        { occurrence_id: "second:2026-08-18", event_id: "second", title: "두 번째 일정", description: null, local_start: "2026-08-18T11:00:00+09:00", local_end: "2026-08-18T12:00:00+09:00", location: null },
      ]);
    }
    throw new Error(`Unexpected path: ${path}`);
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-19T14:00:00Z"));
  render(<StudentPage />);

  const attendanceCopy = await screen.findByText("오늘의 출결과 QR 스캔 기능을 이용할 수 있습니다.");
  const eventsHeading = await screen.findByRole("heading", { name: "이번 주 일정" });
  expect(attendanceCopy.compareDocumentPosition(eventsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("첫 번째 일정")).toBeInTheDocument();
  expect(screen.getByText("두 번째 일정")).toBeInTheDocument();
  expect(screen.queryByText("세 번째 일정")).not.toBeInTheDocument();
  expect(client.api.get).toHaveBeenCalledWith("/api/events?from=2026-08-17&to=2026-08-24");
});
