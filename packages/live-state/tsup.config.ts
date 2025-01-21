import { defineConfig, type Options } from "tsup";

export default defineConfig((options: Options) => [
  {
    entryPoints: {
      index: "./src/index.ts",
      server: "./src/server/index.ts",
    },
    clean: true,
    dts: true,
    format: ["cjs"],
    ...options,
  },
  {
    entryPoints: {
      client: "./src/client/index.ts",
    },
    platform: "browser",
    tsconfig: "./src/client/tsconfig.json",
    clean: true,
    dts: true,
    format: ["cjs"],
    ...options,
  },
]);
