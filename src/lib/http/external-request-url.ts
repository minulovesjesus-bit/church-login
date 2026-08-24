import type { NextRequest } from "next/server";

function firstForwardedValue(value: string | null): string | undefined {
  return value?.split(",", 1)[0]?.trim() || undefined;
}

export function externalRequestUrl(request: NextRequest, path: string): URL {
  const url = new URL(path, request.url);
  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  const developmentHost = process.env.NODE_ENV === "production"
    ? undefined
    : firstForwardedValue(request.headers.get("host"));
  const host = forwardedHost ?? developmentHost;
  const protocol = firstForwardedValue(request.headers.get("x-forwarded-proto"));

  if (host) url.host = host;
  if (protocol === "http" || protocol === "https") url.protocol = `${protocol}:`;
  return url;
}
