import { defineConfig, type Options } from "tsup";

export default defineConfig((options: Options) => ({
	entryPoints: {
		index: "./src/index.ts",
		cli: "./src/cli.ts",
	},
	dts: true,
	format: ["esm"],
	minify: false,
	treeshake: true,
	clean: true,
	banner: {
		js: "#!/usr/bin/env node",
	},
	...options,
}));
