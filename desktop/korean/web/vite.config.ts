import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { koreanRoot } from "../overlay.mjs";

export default defineConfig({
  root: path.join(koreanRoot, "web"),
  base: "/chat/",
  plugins: [react()],
  build: {
    outDir: "../web-dist",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: {
        strategyEmbed: path.join(koreanRoot, "web/strategy/embed.tsx"),
        chat: path.join(koreanRoot, "web/index.html"),
        strategy: path.join(koreanRoot, "web/strategy.html"),
      },
    },
  },
  server: { host: "127.0.0.1", port: 4180, strictPort: true },
});
