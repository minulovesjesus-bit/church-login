import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  oxc: false,
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.join(rootDirectory, "src"),
    },
  },
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
