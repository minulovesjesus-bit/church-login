import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it } from "vitest";

it("configures one explicit FastAPI function bundle with development exclusions", () => {
  const config = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as {
    fluid?: boolean;
    functions?: Record<string, { excludeFiles?: string }>;
  };

  expect(config.fluid).toBe(true);
  expect(config.functions?.["api/index.py"]?.excludeFiles).toBe(
    "{tests/**,docs/**,.superpowers/**,fixtures/**,**/fixtures/**}",
  );
  expect(Object.keys(config.functions ?? {})).toEqual(["api/index.py"]);
});
