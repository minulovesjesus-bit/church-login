import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), search: "" }));
const TestApiClientError = vi.hoisted(() => class extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
});

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("@/lib/api/client", () => ({ api: mockApi, ApiClientError: TestApiClientError }));

import CurrentPresencePage from "./page";

const presence = {
  items: [
    {
      student_id: "00000000-0000-4000-8000-000000000101",
      student_name: "김민준",
      student_email: "minjun@example.test",
      student_phone: "01012345678",
      guardian_phone: "01098765432",
      birth_date: "2012-08-26",
      checked_in_at: "2026-08-25T04:00:00Z",
      source: "QR",
      excluded_from_statistics: true,
    },
    {
      student_id: "00000000-0000-4000-8000-000000000102",
      student_name: "박학생",
      student_email: "park@example.test",
      student_phone: "01022223333",
      guardian_phone: "01044445555",
      birth_date: "2011-03-04",
      checked_in_at: "2026-08-25T03:30:00Z",
      source: "MANUAL",
      excluded_from_statistics: false,
    },
  ],
  total: 21,
  page: 1,
  page_size: 20,
  as_of_date: "2026-08-25",
  timezone: "Asia/Seoul",
};

afterEach(() => {
  navigation.replace.mockReset();
  navigation.search = "";
  vi.useRealTimers();
});

it("shows only current students with age, contacts, entry details, and exclusion status", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-25T05:00:00Z"));
  mockApi.get.mockResolvedValue(presence);

  render(<CurrentPresencePage />);

  expect(screen.getByRole("status")).toHaveTextContent("현재 입실 학생을 불러오고 있어요");
  expect(await screen.findByRole("heading", { name: "현재 입실 상태" })).toBeInTheDocument();
  expect(mockApi.get).toHaveBeenCalledWith(
    "/api/teacher/attendance/current?page=1&page_size=20",
  );

  const table = screen.getByRole("table", { name: "현재 입실 학생 목록" });
  const row = within(table).getByRole("row", { name: /김민준/ });
  expect(row).toHaveTextContent("minjun@example.test");
  expect(row).toHaveTextContent("만 13세");
  expect(row).toHaveTextContent("01012345678");
  expect(row).toHaveTextContent("01098765432");
  expect(row).toHaveTextContent("오후 1:00");
  expect(row).toHaveTextContent("1시간");
  expect(row).toHaveTextContent("QR 출결");
  expect(row).toHaveTextContent("통계 제외");
  const manualRow = within(table).getByRole("row", { name: /박학생/ });
  expect(manualRow).toHaveTextContent("수동 기록");
  expect(manualRow).toHaveTextContent("통계 포함");

  const cards = screen.getByRole("list", { name: "모바일 현재 입실 학생 목록" });
  expect(within(cards).getByText("김민준")).toBeInTheDocument();
  expect(within(cards).getByText("만 13세")).toBeInTheDocument();
  expect(screen.getByText("현재 21명")).toBeInTheDocument();
});

it("uses bounded search and pagination URLs", async () => {
  navigation.search = "query=%EA%B9%80%20%EB%AF%BC%EC%A4%80&page=1";
  mockApi.get.mockResolvedValue(presence);

  render(<CurrentPresencePage />);

  await screen.findByRole("heading", { name: "현재 입실 상태" });
  expect(mockApi.get).toHaveBeenCalledWith(
    "/api/teacher/attendance/current?query=%EA%B9%80+%EB%AF%BC%EC%A4%80&page=1&page_size=20",
  );

  const search = screen.getByRole("searchbox", { name: "현재 입실 학생 검색" });
  fireEvent.change(search, { target: { value: "  박   학생  " } });
  fireEvent.submit(search.closest("form")!);
  expect(navigation.replace).toHaveBeenCalledWith(
    "/teacher/attendance/current?query=%EB%B0%95+%ED%95%99%EC%83%9D&page=1",
  );

  fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
  expect(navigation.replace).toHaveBeenCalledWith(
    "/teacher/attendance/current?query=%EA%B9%80+%EB%AF%BC%EC%A4%80&page=2",
  );
});

it("shows the current-presence empty state", async () => {
  mockApi.get.mockResolvedValue({ ...presence, items: [], total: 0 });

  render(<CurrentPresencePage />);

  expect(await screen.findByText("현재 입실 중인 학생이 없습니다.")).toBeInTheDocument();
});

it.each([
  ["AUTH_REQUIRED", "/login"],
  ["FORBIDDEN", "/student"],
])("redirects %s responses", async (code, destination) => {
  mockApi.get.mockRejectedValue(new TestApiClientError(code, "권한 없음"));

  render(<CurrentPresencePage />);

  await vi.waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(destination));
});

it("offers a retry for temporary failures", async () => {
  mockApi.get
    .mockRejectedValueOnce(new TestApiClientError("REQUEST_FAILED", "잠시 후 다시 시도해 주세요."))
    .mockResolvedValueOnce(presence);

  render(<CurrentPresencePage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByRole("heading", { name: "현재 입실 상태" })).toBeInTheDocument();
});
