import path from "node:path";
import { defineConfig } from "vitest/config";

const web = path.resolve(import.meta.dirname, "apps/web");

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/web/test/**/*.test.ts"],
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "server-only": path.join(web, "test/server-only-stub.ts"),
      "@": web,
    },
  },
});
