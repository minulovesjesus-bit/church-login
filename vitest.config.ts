import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
