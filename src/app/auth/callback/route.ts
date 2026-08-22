import { NextResponse, type NextRequest } from "next/server";

import {
  TEACHER_OAUTH_INTENT_COOKIE,
  verifyTeacherOAuthIntent,
} from "@/lib/auth/teacher-oauth-intent";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const ALLOWED_NEXT_PATHS = new Set(["/onboarding", "/student"]);

function allowedNextPath(value: string | null): string {
  return value && ALLOWED_NEXT_PATHS.has(value) ? value : "/onboarding";
}

function consumeTeacherIntentCookie(
  response: NextResponse,
  request: NextRequest,
): NextResponse {
  response.cookies.set(TEACHER_OAUTH_INTENT_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/auth",
    maxAge: 0,
  });
  return response;
}

function teacherDestination(request: NextRequest): string | undefined {
  const presentedIntent = request.nextUrl.searchParams.get("teacher_intent");
  const cookieIntent = request.cookies.get(TEACHER_OAUTH_INTENT_COOKIE)?.value;
  const secret = process.env.TEACHER_OAUTH_INTENT_SECRET;
  if (!presentedIntent || !cookieIntent || presentedIntent !== cookieIntent || !secret) {
    return undefined;
  }
  return verifyTeacherOAuthIntent(presentedIntent, secret);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const teacherNext = teacherDestination(request);
  const next = teacherNext ?? allowedNextPath(request.nextUrl.searchParams.get("next"));
  if (!code) {
    if (teacherNext) {
      return NextResponse.redirect(
        new URL("/teacher/login?error=oauth_callback", request.url),
      );
    }
    return consumeTeacherIntentCookie(
      NextResponse.redirect(new URL("/auth/login", request.url)),
      request,
    );
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error && teacherNext) {
    return NextResponse.redirect(
      new URL("/teacher/login?error=oauth_callback", request.url),
    );
  }
  const destination = error ? "/auth/login" : next;
  return consumeTeacherIntentCookie(
    NextResponse.redirect(new URL(destination, request.url)),
    request,
  );
}
