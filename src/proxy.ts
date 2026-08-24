import { NextResponse, type NextRequest } from "next/server";

import { externalRequestUrl } from "@/lib/http/external-request-url";
import { refreshSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const externalUrl = externalRequestUrl(
    request,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  if (externalUrl.hostname === "0.0.0.0" || externalUrl.hostname === "127.0.0.1") {
    const canonicalUrl = new URL(externalUrl);
    canonicalUrl.hostname = "localhost";
    return NextResponse.redirect(canonicalUrl);
  }
  return refreshSupabaseSession(request);
}

export const config = {
  matcher: ["/", "/auth/:path*", "/student/:path*", "/teacher/:path*", "/admin/:path*"],
};
