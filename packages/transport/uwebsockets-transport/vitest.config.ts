import { defineConfig } from "vitest/config";

// run workspace packages from src, so no build is needed before testing
const conditions = ["@source"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    pool: "threads", // @pm2/io's process.send() collides with the forks pool's IPC
  },
});
