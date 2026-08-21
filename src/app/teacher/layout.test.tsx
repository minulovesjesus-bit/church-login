import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

const navigation = vi.hoisted(() => ({ pathname: "/teacher", replace: vi.fn() }));
const TestApiClientError = vi.hoisted(() => class extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
});
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname, useRouter: () => navigation }));
vi.mock("@/lib/api/client", () => ({ api: mockApi, ApiClientError: TestApiClientError }));

import TeacherLayout from "./layout";

afterEach(() => {
  navigation.pathname = "/teacher";
  navigation.replace.mockReset();
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

it("shows administrator links only when the API grants admin capability", async () => {
  mockApi.get.mockResolvedValue({ capabilities: { teacher: true, admin: true } });
  render(<TeacherLayout><h1>관리자 화면</h1></TeacherLayout>);

  const nav = await screen.findByRole("navigation", { name: "교사 메뉴" });
  expect(within(nav).getByRole("link", { name: "교사 신청" })).toHaveAttribute("href", "/teacher/applications");
  expect(within(nav).getByRole("link", { name: "교사 권한" })).toHaveAttribute("href", "/admin/staff");
  expect(within(nav).getByRole("link", { name: "키오스크" })).toHaveAttribute("href", "/admin/kiosks");
});

it("exposes labelled drawer controls and closes with Escape", async () => {
  mockApi.get.mockResolvedValue({ capabilities: { teacher: true, admin: false } });
  render(<TeacherLayout><h1>보호 화면</h1></TeacherLayout>);
  const open = await screen.findByRole("button", { name: "교사 메뉴 열기" });
  expect(open).toHaveAttribute("aria-expanded", "false");
  expect(open).toHaveAttribute("aria-controls", "teacher-navigation");

  fireEvent.click(open);
  expect(open).toHaveAttribute("aria-expanded", "true");
  expect(screen.getAllByRole("button", { name: "교사 메뉴 닫기" })).toHaveLength(2);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(open).toHaveAttribute("aria-expanded", "false");
  expect(screen.getAllByRole("button", { name: "교사 메뉴 닫기" })).toHaveLength(1);
});

it("closes the drawer on link activation and every pathname change including browser back", async () => {
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
