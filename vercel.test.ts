import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it } from "vitest";

it("enables Fluid Compute without changing the FastAPI function bundle exclusion", () => {
  const config = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as {
    fluid?: boolean;
    functions?: Record<string, { excludeFiles?: string }>;
  };

  expect(config.fluid).toBe(true);
  expect(config.functions?.["api/**/*.py"]?.excludeFiles).toBe(
    "{tests/**,.superpowers/**,fixtures/**,**/fixtures/**}",
  );
});
