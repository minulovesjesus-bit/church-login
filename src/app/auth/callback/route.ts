import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

const ALLOWED_NEXT_PATHS = new Set(["/onboarding", "/student", "/teacher/apply"]);

function allowedNextPath(value: string | null): string {
  return value && ALLOWED_NEXT_PATHS.has(value) ? value : "/onboarding";
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = allowedNextPath(request.nextUrl.searchParams.get("next"));
  if (!code) return NextResponse.redirect(new URL("/auth/login", request.url));

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/auth/login", request.url));
  return NextResponse.redirect(new URL(next, request.url));
}
