import { afterEach, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({ auth: { getSession } }),
}));

import { api, apiFetch } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  getSession.mockReset();
});

it("sends the Supabase access token only as Authorization and omits cookies", async () => {
  getSession.mockResolvedValue({ data: { session: { access_token: "session-token" } } });
  const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchSpy);

  await apiFetch("/api/me", {
    credentials: "include",
    headers: { Cookie: "sb-refresh-token=never-forward", "X-Request": "test" },
  });

  const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  const headers = new Headers(init.headers);
  expect(init.credentials).toBe("omit");
  expect(headers.get("authorization")).toBe("Bearer session-token");
  expect(headers.get("cookie")).toBeNull();
  expect(headers.get("x-request")).toBe("test");
});

it("sends bearer-authenticated DELETE requests and accepts an empty 204 response", async () => {
  getSession.mockResolvedValue({ data: { session: { access_token: "session-token" } } });
  const fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    status: 204,
    json: async () => { throw new SyntaxError("empty body"); },
  });
  vi.stubGlobal("fetch", fetchSpy);

  await expect(api.delete("/api/teacher/events/event-1")).resolves.toEqual({});

  const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  expect(init.method).toBe("DELETE");
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer session-token");
  expect(init.credentials).toBe("omit");
});
