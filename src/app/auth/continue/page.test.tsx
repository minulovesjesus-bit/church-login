import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mockApi } from "@/test/mock-api";

const getSession = vi.hoisted(() => vi.fn());
const refreshSession = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ replace: vi.fn() }));
const TestApiClientError = vi.hoisted(() => class extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
});

vi.mock("@/lib/api/client", () => ({ api: mockApi, ApiClientError: TestApiClientError }));
vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({ auth: { getSession, refreshSession } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import AuthContinuePage from "./page";

const validSession = { access_token: "test-access-token" };

beforeEach(() => {
  getSession.mockReset();
  refreshSession.mockReset();
  router.replace.mockReset();
  getSession.mockResolvedValue({ data: { session: validSession } });
  refreshSession.mockResolvedValue({ data: { session: null }, error: new Error("refresh failed") });
});

afterEach(() => {
  vi.useRealTimers();
});

it.each([
  [{ onboarding_completed: false, capabilities: { student: false, teacher: false, admin: false } }, "/onboarding"],
  [{ onboarding_completed: true, capabilities: { student: true, teacher: false, admin: false } }, "/student"],
  [{ onboarding_completed: true, capabilities: { student: true, teacher: true, admin: false } }, "/student"],
  [{ onboarding_completed: true, capabilities: { student: true, teacher: true, admin: true } }, "/student"],
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

it("waits through a short post-OAuth auth outage before routing the student", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  mockApi.get.mockImplementation(() => {
    if (Date.now() < 5_000) {
      return Promise.reject(new TestApiClientError("AUTH_REQUIRED", "로그인이 필요합니다."));
    }
    return Promise.resolve({
      onboarding_completed: true,
      capabilities: { student: true, teacher: false, admin: false },
    });
  });
  refreshSession.mockResolvedValue({ data: { session: validSession }, error: null });

  render(<AuthContinuePage />);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(4_999);
  });
  expect(router.replace).not.toHaveBeenCalledWith("/login");

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_001);
  });
  expect(router.replace).toHaveBeenCalledWith("/student");
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
