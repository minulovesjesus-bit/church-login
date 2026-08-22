import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { glob } from "@vercel/build-utils";
import { build } from "@vercel/python";

const sourceRoot = process.cwd();
const workPath = await mkdtemp(join(tmpdir(), "church-python-builder-"));

try {
  const files = await glob("**", {
    cwd: sourceRoot,
    dot: true,
    ignore: [
      ".git/**",
      ".next/**",
      ".vercel/**",
      "node_modules/**",
      "tests/**",
      "docs/**",
      ".superpowers/**",
      "fixtures/**",
      "**/fixtures/**",
    ],
  });
  const result = await build({
    files,
    entrypoint: "api/index.py",
    workPath,
    repoRootPath: workPath,
    config: { framework: "fastapi" },
    meta: { isDev: false },
  });

  assert.equal(result.resultVersion, 2);
  assert.deepEqual(Object.keys(result.result.output), ["fastapi"]);
  const lambda = result.result.output.fastapi;
  assert.equal(lambda.handler, "vc__handler__python.vc_handler");
  const bundledPaths = Object.keys(lambda.files ?? {});
  assert.ok(bundledPaths.includes("api/index.py"));
  assert.ok(bundledPaths.includes("backend/main.py"));
  assert.ok(result.result.routes?.some((route) => route.dest === "/fastapi"));

  console.log(
    JSON.stringify({
      resultVersion: result.resultVersion,
      outputKeys: Object.keys(result.result.output),
      handler: lambda.handler,
      routeCount: result.result.routes?.length ?? 0,
      bundledApiEntrypoint: bundledPaths.includes("api/index.py"),
      bundledBackendApp: bundledPaths.includes("backend/main.py"),
    }),
  );
} finally {
  await rm(workPath, { recursive: true, force: true });
}
