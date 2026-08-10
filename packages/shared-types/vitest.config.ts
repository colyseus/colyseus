import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    typecheck: {
      // expectTypeOf() assertions are runtime no-ops; without typecheck mode
      // they are never enforced
      enabled: true,
      include: ["test/**/*.test.ts", "test/**/*.test-d.ts"],
    },
  },
});
