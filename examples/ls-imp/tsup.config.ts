import { defineConfig, type Options } from "tsup";

export default defineConfig((options: Options) => ({
  entryPoints: ["./src/index.ts", "./src/schema.ts"],
  clean: true,
  dts: true,
  format: ["esm"],
  ...options,
}));
