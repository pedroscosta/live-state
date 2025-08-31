import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    coverage: {
      reporter: ["text", "json-summary"],
      exclude: [
        ...(configDefaults.coverage.exclude || []),
        "src/core/schemas/**",
        "src/core/utils.ts",
        "src/client/index.ts",
        "src/index.ts",
      ],
    },
  },
});
