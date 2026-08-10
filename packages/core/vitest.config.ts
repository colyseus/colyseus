import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // compile-only type tests — no runtime test files in this package
    include: [],
    typecheck: {
      enabled: true,
      only: true,
      include: ["test/**/*.test-d.ts"],
      tsconfig: "./test/tsconfig.json",
    },
  },
});
