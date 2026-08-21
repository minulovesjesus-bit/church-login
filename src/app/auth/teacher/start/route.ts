import { NextResponse, type NextRequest } from "next/server";

import {
  createTeacherOAuthIntent,
  TEACHER_OAUTH_INTENT_COOKIE,
  TEACHER_OAUTH_INTENT_TTL_SECONDS,
} from "@/lib/auth/teacher-oauth-intent";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function unavailableResponse(request: NextRequest): NextResponse {
  return NextResponse.redirect(
    new URL("/teacher/login?error=oauth_unavailable", request.url),
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.TEACHER_OAUTH_INTENT_SECRET;
  if (!secret) return unavailableResponse(request);

  let intent: string;
  try {
    intent = createTeacherOAuthIntent(secret);
  } catch {
    return unavailableResponse(request);
  }

  const callback = new URL("/auth/callback", request.url);
  callback.searchParams.set("teacher_intent", intent);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callback.toString(),
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) return unavailableResponse(request);

  let oauthUrl: URL;
  try {
    oauthUrl = new URL(data.url);
  } catch {
    return unavailableResponse(request);
  }
  if (!["http:", "https:"].includes(oauthUrl.protocol)) {
    return unavailableResponse(request);
  }

  const response = NextResponse.redirect(oauthUrl);
  response.cookies.set(TEACHER_OAUTH_INTENT_COOKIE, intent, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/auth",
    maxAge: TEACHER_OAUTH_INTENT_TTL_SECONDS,
  });
  return response;
}
