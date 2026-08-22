import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

const navigation = vi.hoisted(() => ({ pathname: "/teacher", replace: vi.fn() }));
const TestApiClientError = vi.hoisted(() => class extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
});
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname, useRouter: () => navigation }));
vi.mock("@/lib/api/client", () => ({ api: mockApi, ApiClientError: TestApiClientError }));

import TeacherLayout from "./layout";

function stubMobileViewport() {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query === "(min-width: 64rem)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
});

afterEach(() => {
  navigation.pathname = "/teacher";
  navigation.replace.mockReset();
  vi.unstubAllGlobals();
});

it.each(["/teacher/login", "/teacher/apply"])("keeps public %s outside the protected shell", (pathname) => {
  navigation.pathname = pathname;
  render(<TeacherLayout><h1>공개 화면</h1></TeacherLayout>);

  expect(screen.getByRole("heading", { name: "공개 화면" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "교사 메뉴" })).not.toBeInTheDocument();
  expect(mockApi.get).not.toHaveBeenCalled();
});

it("shows core links to teachers and never infers administrator authority", async () => {
  mockApi.get.mockResolvedValue({ capabilities: { teacher: true, admin: false } });
  render(<TeacherLayout><h1>보호 화면</h1></TeacherLayout>);

  const nav = await screen.findByRole("navigation", { name: "교사 메뉴" });
  expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
    "/teacher", "/teacher/attendance", "/teacher/students", "/teacher/events",
  ]);
  expect(within(nav).queryByRole("link", { name: "교사 신청" })).not.toBeInTheDocument();
  expect(mockApi.get).toHaveBeenCalledTimes(1);
  expect(mockApi.get).toHaveBeenCalledWith("/api/me", expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it("keeps the pending access state while the identity request is unresolved", () => {
  mockApi.get.mockReturnValue(new Promise(() => undefined));
  render(<TeacherLayout><h1>보호 화면</h1></TeacherLayout>);

  expect(screen.getByRole("status")).toHaveTextContent("교사 권한을 확인하고 있습니다.");
  expect(screen.queryByRole("heading", { name: "보호 화면" })).not.toBeInTheDocument();
});

it.each([
  [new TestApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."), "/teacher/login"],
  [new TestApiClientError("FORBIDDEN", "교사 권한이 필요합니다."), "/teacher/apply"],
  [{ capabilities: { teacher: false, admin: false } }, "/teacher/apply"],
])("preserves the teacher access redirect for %#", async (result, destination) => {
  if (result instanceof Error) mockApi.get.mockRejectedValue(result);
  else mockApi.get.mockResolvedValue(result);

  render(<TeacherLayout><h1>보호 화면</h1></TeacherLayout>);

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(destination));
  expect(screen.queryByRole("heading", { name: "보호 화면" })).not.toBeInTheDocument();
});

it("keeps identity failures retryable without losing the protected route", async () => {
  mockApi.get
    .mockRejectedValueOnce(new TestApiClientError("REQUEST_FAILED", "교사 메뉴를 불러오지 못했습니다."))
    .mockResolvedValueOnce({ capabilities: { teacher: true, admin: false } });

  render(<TeacherLayout><h1>보호 화면</h1></TeacherLayout>);

  expect(await screen.findByRole("alert")).toHaveTextContent("교사 메뉴를 불러오지 못했습니다.");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByRole("heading", { name: "보호 화면" })).toBeInTheDocument();
  expect(mockApi.get).toHaveBeenCalledTimes(2);
});

it("aborts the identity request when the protected layout unmounts", () => {
  mockApi.get.mockReturnValue(new Promise(() => undefined));
  const view = render(<TeacherLayout><h1>보호 화면</h1></TeacherLayout>);
  const signal = mockApi.get.mock.calls[0]?.[1]?.signal as AbortSignal;

  expect(signal.aborted).toBe(false);
  view.unmount();
  expect(signal.aborted).toBe(true);
});

it("shows administrator links only when the API grants admin capability", async () => {
  mockApi.get.mockResolvedValue({ capabilities: { teacher: true, admin: true } });
  render(<TeacherLayout><h1>관리자 화면</h1></TeacherLayout>);

  const nav = await screen.findByRole("navigation", { name: "교사 메뉴" });
  expect(within(nav).getByRole("link", { name: "교사 신청" })).toHaveAttribute("href", "/teacher/applications");
  expect(within(nav).getByRole("link", { name: "교사 권한" })).toHaveAttribute("href", "/admin/staff");
  expect(within(nav).getByRole("link", { name: "키오스크" })).toHaveAttribute("href", "/admin/kiosks");
});

it("exposes one labelled staff navigation and restores focus after closing the Sheet with Escape", async () => {
  stubMobileViewport();
  mockApi.get.mockResolvedValue({ capabilities: { teacher: true, admin: false } });
  render(<TeacherLayout><h1>보호 화면</h1></TeacherLayout>);
  const open = await screen.findByRole("button", { name: "교사 메뉴 열기" });
  expect(open).toHaveAttribute("aria-expanded", "false");
  expect(open).toHaveAttribute("aria-controls", "teacher-navigation");
  const closedNavigation = screen.getAllByRole("navigation", { name: "교사 메뉴" });
  expect(closedNavigation).toHaveLength(1);
  expect(within(closedNavigation[0]).getByRole("button", { name: "교사 메뉴 열기" })).toBe(open);

  fireEvent.click(open);
  expect(open).toHaveAttribute("aria-expanded", "true");
  expect(await screen.findByRole("dialog", { name: "교사 메뉴" })).toBeInTheDocument();
  expect(screen.getAllByRole("navigation", { name: "교사 메뉴" })).toHaveLength(1);
  expect(open).not.toHaveFocus();

  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(open).toHaveAttribute("aria-expanded", "false"));
  await waitFor(() => expect(open).toHaveFocus());
  expect(screen.getAllByRole("navigation", { name: "교사 메뉴" })).toHaveLength(1);
});

it("closes the drawer on link activation and every pathname change including browser back", async () => {
  stubMobileViewport();
  mockApi.get.mockResolvedValue({ capabilities: { teacher: true, admin: false } });
  const view = render(<TeacherLayout><h1>보호 화면</h1></TeacherLayout>);
  const open = await screen.findByRole("button", { name: "교사 메뉴 열기" });

  fireEvent.click(open);
  const attendanceLink = screen.getByRole("link", { name: "출결 관리" });
  attendanceLink.addEventListener("click", (event) => event.preventDefault());
  fireEvent.click(attendanceLink);
  expect(open).toHaveAttribute("aria-expanded", "false");

  fireEvent.click(open);
  navigation.pathname = "/teacher/students";
  view.rerender(<TeacherLayout><h1>보호 화면</h1></TeacherLayout>);
  await vi.waitFor(() => expect(open).toHaveAttribute("aria-expanded", "false"));

  fireEvent.click(open);
  navigation.pathname = "/teacher";
  view.rerender(<TeacherLayout><h1>보호 화면</h1></TeacherLayout>);
  await vi.waitFor(() => expect(open).toHaveAttribute("aria-expanded", "false"));
});
