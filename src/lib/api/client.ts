import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type ErrorEnvelope = { error?: { code?: string; message?: string; request_id?: string } };

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message = "요청을 처리하지 못했습니다.",
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

export async function parseApiResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as ErrorEnvelope | T;
  if (!response.ok) {
    const error = (body as ErrorEnvelope).error;
    throw new ApiClientError(error?.code ?? "REQUEST_FAILED", error?.message, error?.request_id);
  }
  return body as T;
}

export async function apiFetch<T>(
  path: `/api/${string}`,
  init: RequestInit = {},
): Promise<T> {
  const supabase = createBrowserSupabaseClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new ApiClientError("AUTH_REQUIRED", "로그인이 필요합니다.");
  const headers = new Headers(init.headers);
  headers.delete("cookie");
  headers.set("Authorization", `Bearer ${data.session.access_token}`);
  const response = await fetch(path, {
    ...init,
    credentials: "omit",
    headers,
  });
  return parseApiResponse<T>(response);
}

function jsonRequest(method: "POST" | "PATCH") {
  return <T>(path: `/api/${string}`, body: unknown): Promise<T> =>
    apiFetch<T>(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
}

export const api = {
  get: <T>(path: `/api/${string}`, init: RequestInit = {}) => apiFetch<T>(path, init),
  post: jsonRequest("POST"),
  patch: jsonRequest("PATCH"),
  delete: <T = void>(path: `/api/${string}`) => apiFetch<T>(path, { method: "DELETE" }),
};
