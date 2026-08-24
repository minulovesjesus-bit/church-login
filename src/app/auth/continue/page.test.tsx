import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

const getSession = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ replace: vi.fn() }));
const TestApiClientError = vi.hoisted(() => class extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
});

vi.mock("@/lib/api/client", () => ({ api: mockApi, ApiClientError: TestApiClientError }));
vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({ auth: { getSession } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import AuthContinuePage from "./page";

const validSession = { access_token: "test-access-token" };

beforeEach(() => {
  getSession.mockReset();
  router.replace.mockReset();
  getSession.mockResolvedValue({ data: { session: validSession } });
});

it.each([
  [{ onboarding_completed: false, capabilities: { student: false, teacher: false, admin: false } }, "/onboarding"],
  [{ onboarding_completed: true, capabilities: { student: true, teacher: false, admin: false } }, "/student"],
  [{ onboarding_completed: true, capabilities: { student: true, teacher: true, admin: false } }, "/teacher"],
  [{ onboarding_completed: true, capabilities: { student: true, teacher: true, admin: true } }, "/teacher"],
])("routes the current identity to %s", async (identity, destination) => {
  mockApi.get.mockResolvedValue(identity);
  render(<AuthContinuePage />);

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith(destination));
});

it("returns an account without a session to unified login", async () => {
  getSession.mockResolvedValue({ data: { session: null } });
  render(<AuthContinuePage />);

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
  expect(mockApi.get).not.toHaveBeenCalled();
});

it("returns an AUTH_REQUIRED identity request to unified login", async () => {
  mockApi.get.mockRejectedValue(new TestApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."));
  render(<AuthContinuePage />);

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
});

it("keeps a transient identity failure actionable and retries it", async () => {
  mockApi.get
    .mockRejectedValueOnce(new TestApiClientError("REQUEST_FAILED", "잠시 후 다시 시도해 주세요."))
    .mockResolvedValueOnce({ onboarding_completed: true, capabilities: { student: true, teacher: false, admin: false } });
  render(<AuthContinuePage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/student"));
  expect(mockApi.get).toHaveBeenCalledTimes(2);
});
