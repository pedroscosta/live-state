import { defineConfig, type Options } from "tsup";

export default defineConfig((options: Options) => [
  {
    entryPoints: {
      index: "./src/index.ts",
      server: "./src/server/index.ts",
    },
    dts: true,
    format: ["cjs", "esm"],
    minify: process.env.NODE_ENV === "production",
    treeshake: true,
    clean: process.env.NODE_ENV === "production",
    ...options,
  },
  {
    entryPoints: {
      client: "./src/client/index.ts",
      "fetch-client": "./src/client/fetch/index.ts",
      "optimistic-client": "./src/client/optimistic/index.ts",
    },
    platform: "browser",
    tsconfig: "./src/client/tsconfig.json",
    dts: true,
    format: ["esm"],
    minify: process.env.NODE_ENV === "production",
    treeshake: true,
    clean: process.env.NODE_ENV === "production",
    ...options,
  },
]);
