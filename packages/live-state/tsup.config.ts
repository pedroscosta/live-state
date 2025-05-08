import { defineConfig, type Options } from "tsup";

export default defineConfig((options: Options) => [
  {
    entryPoints: {
      index: "./src/index.ts",
      server: "./src/server/index.ts",
    },
    dts: true,
    format: ["cjs", "esm"],
    minify: true,
    treeshake: true,
    ...options,
  },
  {
    entryPoints: {
      client: "./src/client/index.ts",
    },
    platform: "browser",
    tsconfig: "./src/client/tsconfig.json",
    dts: true,
    format: ["esm"],
    minify: true,
    treeshake: true,
    ...options,
  },
]);
