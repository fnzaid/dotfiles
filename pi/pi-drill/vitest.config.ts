import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "bench/**/*.ts"],
      // run.ts is the command-line wrapper: argument parsing and printing around bench/core.ts.
      exclude: ["bench/run.ts", "bench/fixture/**"],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
