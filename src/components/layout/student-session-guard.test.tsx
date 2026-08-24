import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const getSession = vi.hoisted(() => vi.fn());
const createBrowserSupabaseClient = vi.hoisted(() => vi.fn(() => ({
  auth: { getSession },
})));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserSupabaseClient }));

import { StudentSessionGuard } from "./student-session-guard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function sessionResult(session: object | null, error: Error | null = null) {
  return { data: { session }, error };
}

function restoreFromBackForwardCache() {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  window.dispatchEvent(event);
}

afterEach(() => {
  router.replace.mockReset();
  getSession.mockReset();
  createBrowserSupabaseClient.mockClear();
});

it("hides protected content until one shared mount validation confirms a session", async () => {
  const request = deferred<ReturnType<typeof sessionResult>>();
  getSession.mockReturnValue(request.promise);

  render(<StudentSessionGuard><p>보호된 학생 화면</p></StudentSessionGuard>);

  expect(screen.queryByText("보호된 학생 화면")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("로그인 상태를 확인하고 있습니다.");
  expect(createBrowserSupabaseClient).toHaveBeenCalledTimes(1);
  expect(getSession).toHaveBeenCalledTimes(1);

  await act(async () => request.resolve(sessionResult({ user: { id: "student" } })));
  expect(screen.getByText("보호된 학생 화면")).toBeVisible();
  expect(router.replace).not.toHaveBeenCalled();
});

it("revalidates a BFCache restoration and keeps protected history hidden after logout", async () => {
  getSession
    .mockResolvedValueOnce(sessionResult({ user: { id: "student" } }))
    .mockResolvedValueOnce(sessionResult(null));

  render(<StudentSessionGuard><p>보호된 학생 화면</p></StudentSessionGuard>);
  expect(await screen.findByText("보호된 학생 화면")).toBeVisible();

  act(restoreFromBackForwardCache);

  expect(screen.queryByText("보호된 학생 화면")).not.toBeInTheDocument();
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
  expect(screen.queryByText("보호된 학생 화면")).not.toBeInTheDocument();
  expect(getSession).toHaveBeenCalledTimes(2);
});

it("does not duplicate an in-flight validation or redirect an authenticated restoration", async () => {
  const request = deferred<ReturnType<typeof sessionResult>>();
  getSession.mockReturnValue(request.promise);

  render(<StudentSessionGuard><p>보호된 학생 화면</p></StudentSessionGuard>);
  act(restoreFromBackForwardCache);
  expect(getSession).toHaveBeenCalledTimes(1);

  await act(async () => request.resolve(sessionResult({ user: { id: "student" } })));
  expect(screen.getByText("보호된 학생 화면")).toBeVisible();
  expect(router.replace).not.toHaveBeenCalled();
});

it.each([
  ["returned auth error", () => Promise.resolve(sessionResult(null, new Error("offline")))],
  ["thrown auth error", () => Promise.reject(new Error("offline"))],
] as const)("fails closed without redirecting after a %s", async (_case, result) => {
  getSession.mockImplementation(result);

  render(<StudentSessionGuard><p>보호된 학생 화면</p></StudentSessionGuard>);

  expect(await screen.findByRole("alert")).toHaveTextContent("로그인 상태를 확인하지 못했습니다.");
  expect(screen.queryByText("보호된 학생 화면")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "다시 시도" })).toBeEnabled();
  expect(router.replace).not.toHaveBeenCalled();
});

it("recovers protected content only after an explicit successful retry", async () => {
  getSession
    .mockResolvedValueOnce(sessionResult(null, new Error("offline")))
    .mockResolvedValueOnce(sessionResult({ user: { id: "student" } }));

  render(<StudentSessionGuard><p>보호된 학생 화면</p></StudentSessionGuard>);

  const retry = await screen.findByRole("button", { name: "다시 시도" });
  expect(screen.queryByText("보호된 학생 화면")).not.toBeInTheDocument();
  await act(async () => retry.click());

  expect(await screen.findByText("보호된 학생 화면")).toBeVisible();
  expect(getSession).toHaveBeenCalledTimes(2);
  expect(router.replace).not.toHaveBeenCalled();
});

it("fails closed when BFCache revalidation returns an error", async () => {
  getSession
    .mockResolvedValueOnce(sessionResult({ user: { id: "student" } }))
    .mockResolvedValueOnce(sessionResult(null, new Error("offline")));

  render(<StudentSessionGuard><p>보호된 학생 화면</p></StudentSessionGuard>);
  expect(await screen.findByText("보호된 학생 화면")).toBeVisible();

  act(restoreFromBackForwardCache);

  expect(screen.queryByText("보호된 학생 화면")).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("로그인 상태를 확인하지 못했습니다.");
  expect(screen.getByRole("button", { name: "다시 시도" })).toBeEnabled();
  expect(router.replace).not.toHaveBeenCalled();
});
