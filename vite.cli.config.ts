import { resolve } from "node:path";
import { defineConfig } from "vite";

/** The `tiktok-poster` CLI: one CommonJS file for Node (or the app's Electron in Node mode), no dependencies. */
export default defineConfig({
  resolve: { alias: { "@shared": resolve(__dirname, "src/shared") } },
  build: {
    ssr: "src/cli/index.ts",
    outDir: "out/cli",
    target: "node20",
    minify: false,
    rollupOptions: { output: { format: "cjs", entryFileNames: "index.js", banner: "#!/usr/bin/env node" } },
  },
});
