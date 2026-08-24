import type { ReactNode } from "react";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

const navigation = vi.hoisted(() => ({ pathname: "/student" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("./scan/scan-client", () => ({ StudentScanClient: () => <p>스캐너 본문</p> }));
vi.mock("@/lib/api/client", () => ({ api: mockApi }));
vi.mock("@/components/layout/student-session-guard", () => ({
  StudentSessionGuard: ({ children }: { children: ReactNode }) => (
    <div data-testid="student-session-guard">{children}</div>
  ),
}));

import StudentLayout from "./layout";
import StudentScanPage from "./scan/page";

beforeEach(() => {
  mockApi.get.mockResolvedValue({
    capabilities: { student: true, teacher: false, admin: false },
  });
});

afterEach(() => {
  navigation.pathname = "/student";
  mockApi.get.mockReset();
});

it("uses one semantic responsive navigation path with only implemented destinations", () => {
  navigation.pathname = "/student";
  render(<StudentLayout><p>학생 내용</p></StudentLayout>);

  const nav = screen.getByRole("navigation", { name: "학생 메뉴" });
  expect(screen.getAllByRole("navigation", { name: "학생 메뉴" })).toHaveLength(1);
  expect(within(nav).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["홈", "/student"],
    ["QR 출결", "/student/scan"],
    ["출결 기록", "/student/attendance"],
    ["일정", "/student/events"],
  ]);
  expect(within(nav).getByRole("link", { name: "홈" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).queryByRole("link", { name: /프로필/ })).not.toBeInTheDocument();
  expect(nav).toHaveAttribute("data-items", "4");

  for (const link of within(nav).getAllByRole("link")) {
    expect(link.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
    expect(link.querySelector("span")).toHaveTextContent(link.textContent ?? "");
  }

  expect(nav.closest(".student-shell")).not.toBeNull();
  expect(nav.closest(".student-shell")?.querySelector(".student-shell-content")).toContainElement(
    screen.getByText("학생 내용"),
  );
  expect(screen.getByTestId("student-session-guard")).toContainElement(nav);
});

it.each([
  ["teacher", { student: true, teacher: true, admin: false }],
  ["admin", { student: true, teacher: false, admin: true }],
])("appends exactly one teacher mode link for %s capability", async (_role, capabilities) => {
  mockApi.get.mockResolvedValue({ capabilities });
  render(<StudentLayout><p>학생 내용</p></StudentLayout>);

  const nav = screen.getByRole("navigation", { name: "학생 메뉴" });
  expect(await within(nav).findByRole("link", { name: "교사 모드" })).toHaveAttribute(
    "href",
    "/teacher",
  );
  expect(within(nav).getAllByRole("link")).toHaveLength(5);
  expect(nav).toHaveAttribute("data-items", "5");
  expect(within(nav).getAllByRole("link", { name: "교사 모드" })).toHaveLength(1);
});

it("keeps the four-link fallback after the capability lookup failure settles", async () => {
  let rejectRequest!: (reason?: unknown) => void;
  mockApi.get.mockReturnValue(new Promise((_, reject) => {
    rejectRequest = reject;
  }));
  render(<StudentLayout><p>학생 내용</p></StudentLayout>);

  const nav = screen.getByRole("navigation", { name: "학생 메뉴" });
  expect(mockApi.get).toHaveBeenCalledWith(
    "/api/me",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  await act(async () => {
    rejectRequest(new Error("identity unavailable"));
    await Promise.resolve();
  });
  expect(within(nav).queryByRole("link", { name: "교사 모드" })).not.toBeInTheDocument();
  expect(nav).toHaveAttribute("data-items", "4");
});

it("marks the nested student destination active without changing the four links", () => {
  navigation.pathname = "/student/events/details";
  render(<StudentLayout><p>학생 내용</p></StudentLayout>);

  const nav = screen.getByRole("navigation", { name: "학생 메뉴" });
  expect(within(nav).getAllByRole("link")).toHaveLength(4);
  expect(within(nav).getByRole("link", { name: "일정" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByRole("link", { name: "홈" })).not.toHaveAttribute("aria-current");
});

it("aborts the capability request when the navigation unmounts", () => {
  mockApi.get.mockReturnValue(new Promise(() => undefined));
  const view = render(<StudentLayout><p>학생 내용</p></StudentLayout>);
  const signal = mockApi.get.mock.calls[0]?.[1]?.signal as AbortSignal;

  expect(signal.aborted).toBe(false);
  view.unmount();
  expect(signal.aborted).toBe(true);
});

it("keeps the real student scan page root as the shell's direct full-bleed child", () => {
  const { container } = render(
    <StudentLayout><StudentScanPage /></StudentLayout>,
  );

  expect(container.querySelector(".student-shell-content > .student-scan-shell")).toBe(
    screen.getByRole("main"),
  );
});
