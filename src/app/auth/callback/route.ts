import { NextResponse, type NextRequest } from "next/server";

import { externalRequestUrl } from "@/lib/http/external-request-url";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(
      externalRequestUrl(request, "/login?error=oauth_callback"),
    );
  }

  const response = NextResponse.redirect(externalRequestUrl(request, "/auth/continue"));
  const supabase = await createServerSupabaseClient({
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet, headers) => {
      cookiesToSet.forEach(({ name, value, options }) =>
        response.cookies.set(name, value, options),
      );
      Object.entries(headers).forEach(([name, value]) =>
        response.headers.set(name, value),
      );
    },
  });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    response.headers.set(
      "location",
      externalRequestUrl(request, "/login?error=oauth_callback").toString(),
    );
  }
  return response;
}
