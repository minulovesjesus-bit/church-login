import { NextRequest } from "next/server";
import { expect, it } from "vitest";

import { GET } from "./route";

it("redirects the retired teacher OAuth starter to unified login without intent state", async () => {
  const response = await GET(
    new NextRequest("https://church.example.test/auth/teacher/start"),
  );

  expect(response.headers.get("location")).toBe(
    "https://church.example.test/login",
  );
  expect(response.headers.get("set-cookie")).toBeNull();
});
