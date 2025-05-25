import { defineConfig } from "bumpp";
import { globSync } from "tinyglobby";

export default defineConfig({
  files: globSync(["./packages/live-state/package.json"], {
    expandDirectories: false,
  }),
});
