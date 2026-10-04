import path from "node:path";
import { defineConfig, mergeConfig } from "vite";
import upstreamConfig from "../vite.config";
import { koreanPlugin, koreanRoot } from "./overlay.mjs";

export default defineConfig(async (environment) => {
  const base =
    typeof upstreamConfig === "function"
      ? await upstreamConfig(environment)
      : await upstreamConfig;
  return mergeConfig(base, {
    plugins: [koreanPlugin()],
    resolve: {
      alias: { "@buzz-korean": path.join(koreanRoot, "runtime") },
    },
  });
});
