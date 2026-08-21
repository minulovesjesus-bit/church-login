import { execFileSync } from "node:child_process";

export default function globalSetup(): void {
  execFileSync("uv", ["run", "python", "tests/e2e/fixtures/identity_seed.py", "setup"], {
    env: process.env,
    stdio: "inherit",
  });
}
