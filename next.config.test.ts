import { afterEach, expect, it } from "vitest";

import nextConfig from "./next.config";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

it("proxies API calls to the local FastAPI origin only during development", async () => {
  process.env.NODE_ENV = "development";

  await expect(nextConfig.rewrites?.()).resolves.toEqual([
    {
      source: "/api/:path*",
      destination: "http://127.0.0.1:8000/api/:path*",
    },
  ]);
});

it("leaves production API routing available to Vercel", async () => {
  process.env.NODE_ENV = "production";

  await expect(nextConfig.rewrites?.()).resolves.toEqual([]);
});
