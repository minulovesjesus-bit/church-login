import { execFileSync } from "node:child_process";

export default function globalTeardown(): void {
  execFileSync("uv", ["run", "python", "tests/e2e/fixtures/identity_seed.py", "teardown"], {
    env: process.env,
    stdio: "inherit",
  });
}
