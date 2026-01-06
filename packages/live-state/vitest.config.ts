import codspeedPlugin from "@codspeed/vitest-plugin";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [codspeedPlugin()],
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
      include: ["./test/**/*.test-d.ts"],
      ignoreSourceErrors: true,
    },
  },
});
