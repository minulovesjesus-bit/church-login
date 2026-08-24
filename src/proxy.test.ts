import { NextRequest, NextResponse } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const refreshSupabaseSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/proxy", () => ({ refreshSupabaseSession }));

import { proxy } from "./proxy";

beforeEach(() => {
  refreshSupabaseSession.mockReset();
  refreshSupabaseSession.mockResolvedValue(NextResponse.next());
});

it("moves local authentication from 0.0.0.0 to the canonical localhost host", async () => {
  const response = await proxy(
    new NextRequest("http://0.0.0.0:3000/login"),
  );

  expect(response.headers.get("location")).toBe(
    "http://localhost:3000/login",
  );
  expect(refreshSupabaseSession).not.toHaveBeenCalled();
});

it("does not redirect when only the server bind address is 0.0.0.0", async () => {
  const request = new NextRequest("http://0.0.0.0:3000/login", {
    headers: { host: "localhost:3000" },
  });

  const response = await proxy(request);

  expect(response.headers.get("location")).toBeNull();
  expect(refreshSupabaseSession).toHaveBeenCalledWith(request);
});
