import { ApiClientError } from "./client";

type ErrorEnvelope = {
  error?: { code?: string; message?: string; request_id?: string };
};

export type KioskSession = {
  session_id: string;
  device_name: string;
  access_expires_at: string;
  refresh_expires_at: string;
};

export type KioskQrChallenge = {
  token: string;
  issued_at: string;
  expires_at: string;
};

export async function kioskFetch<T = void>(
  path: `/api/kiosk/${string}`,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.delete("authorization");
  headers.delete("cookie");

  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers,
  });

  if (response.status === 204 && response.ok) return undefined as T;

  const body = (await response.json().catch(() => ({}))) as ErrorEnvelope | T;
  if (!response.ok) {
    const error = (body as ErrorEnvelope).error;
    throw new ApiClientError(
      error?.code ?? "REQUEST_FAILED",
      error?.message,
      error?.request_id,
    );
  }
  return body as T;
}

function jsonRequest<T>(path: `/api/kiosk/${string}`, body: unknown): Promise<T> {
  return kioskFetch<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const kioskApi = {
  login: (deviceName: string, password: string) =>
    jsonRequest<KioskSession>("/api/kiosk/sessions", {
      device_name: deviceName,
      password,
    }),
  refresh: () =>
    kioskFetch<KioskSession>("/api/kiosk/sessions/refresh", { method: "POST" }),
  getQr: () => kioskFetch<KioskQrChallenge>("/api/kiosk/qr"),
  logout: () =>
    kioskFetch("/api/kiosk/sessions/current", { method: "DELETE" }),
};
