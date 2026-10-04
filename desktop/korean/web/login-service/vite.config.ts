import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root,
  build: {
    ssr: path.join(root, "server.mjs"),
    outDir: "../../login-dist",
    emptyOutDir: true,
    minify: false,
    rollupOptions: { output: { entryFileNames: "server.mjs" } },
  },
  ssr: {
    noExternal: true,
    external: [
      "node:crypto",
      "node:fs",
      "node:path",
      "node:http",
      "node:https",
      "node:util",
      "node:url",
      "node:worker_threads",
    ],
  },
});
