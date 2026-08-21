import { afterEach, expect, it, vi } from "vitest";

import { ApiClientError } from "./client";
import { kioskFetch } from "./kiosk-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("uses only browser-managed kiosk cookies and never forwards bearer or cookie headers", async () => {
  const fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ session_id: "session-1" }),
  });
  vi.stubGlobal("fetch", fetchSpy);

  await kioskFetch("/api/kiosk/sessions/refresh", {
    method: "POST",
    credentials: "omit",
    headers: {
      Authorization: "Bearer must-not-leak",
      Cookie: "kiosk_refresh=must-not-be-readable",
      "X-Request": "kept",
    },
  });

  const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  const headers = new Headers(init.headers);
  expect(init.credentials).toBe("include");
  expect(headers.get("authorization")).toBeNull();
  expect(headers.get("cookie")).toBeNull();
  expect(headers.get("x-request")).toBe("kept");
});

it("accepts the empty successful logout response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 204,
    json: async () => {
      throw new SyntaxError("empty body");
    },
  }));

  await expect(kioskFetch("/api/kiosk/sessions/current", { method: "DELETE" }))
    .resolves.toBeUndefined();
});

it("preserves only the safe error code, message, and ephemeral request id", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false,
    status: 401,
    json: async () => ({
      error: {
        code: "KIOSK_SESSION_REVOKED",
        message: "기기 세션이 만료되었습니다.",
        request_id: "request-1",
        internal: "must-not-surface",
      },
    }),
  }));

  const error = await kioskFetch("/api/kiosk/qr").catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiClientError);
  expect(error).toMatchObject({
    code: "KIOSK_SESSION_REVOKED",
    message: "기기 세션이 만료되었습니다.",
    requestId: "request-1",
  });
  expect(error).not.toHaveProperty("internal");
});
