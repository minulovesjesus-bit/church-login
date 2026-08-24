import { NextResponse, type NextRequest } from "next/server";

export function GET(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/login", request.url));
}
