import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    env: { PGLITE_DIR: "memory://", NODE_ENV: "test", SOLANA_MOCK: "true", DEMO_MODE: "true" },
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
