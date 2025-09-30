import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    coverage: {
      reporter: ["text"],
      reportOnFailure: true,
      exclude: [
        ...(configDefaults.coverage.exclude || []),
        "src/core/schemas/**",
        "src/core/utils.ts",
        "src/client/index.ts",
        "src/index.ts",
      ],
    },
    typecheck: {
      enabled: true,
      tsconfig: "./test/tsconfig.json",
      include: ["src/**/*.test-d.ts"],
    },
  },
});
