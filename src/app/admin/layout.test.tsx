import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
const TestApiClientError = vi.hoisted(() => class extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
});
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/staff", useRouter: () => navigation }));
vi.mock("@/lib/api/client", () => ({ api: mockApi, ApiClientError: TestApiClientError }));

import AdminLayout from "./layout";

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
  navigation.replace.mockReset();
  vi.unstubAllGlobals();
});

it("renders admin routes in the same staff navigation shell", async () => {
  mockApi.get.mockResolvedValue({ capabilities: { teacher: true, admin: true } });

  render(<AdminLayout><h1>교직원 역할 관리</h1></AdminLayout>);

  const nav = await screen.findByRole("navigation", { name: "교사 메뉴" });
  expect(screen.getByRole("heading", { name: "교직원 역할 관리" })).toBeInTheDocument();
  expect(within(nav).getByRole("link", { name: "대시보드" })).toHaveAttribute("href", "/teacher");
  expect(within(nav).getByRole("link", { name: "교사 권한" })).toHaveAttribute("href", "/admin/staff");
  expect(within(nav).getByRole("link", { name: "키오스크" })).toHaveAttribute("href", "/admin/kiosks");
});

it("redirects a non-admin teacher away from every admin route", async () => {
  mockApi.get.mockResolvedValue({ capabilities: { teacher: true, admin: false } });

  render(<AdminLayout><h1>관리자 전용</h1></AdminLayout>);

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/teacher"));
  expect(screen.queryByRole("heading", { name: "관리자 전용" })).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "교사 메뉴" })).not.toBeInTheDocument();
});

it.each([
  [new TestApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."), "/teacher/login"],
  [new TestApiClientError("FORBIDDEN", "교사 권한이 필요합니다."), "/teacher/apply"],
  [{ capabilities: { teacher: false, admin: false } }, "/teacher/apply"],
])("preserves the staff identity redirect for admin route case %#", async (result, destination) => {
  if (result instanceof Error) mockApi.get.mockRejectedValue(result);
  else mockApi.get.mockResolvedValue(result);

  render(<AdminLayout><h1>관리자 전용</h1></AdminLayout>);

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(destination));
  expect(screen.queryByRole("heading", { name: "관리자 전용" })).not.toBeInTheDocument();
});
