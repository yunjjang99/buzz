import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { buildArtifactMatrix } from "../scripts/build-protected-feature-artifacts.mjs";
import { checkOverlay, desktopRoot, koreanRoot } from "./overlay.mjs";

checkOverlay();
const check = spawnSync(
  process.execPath,
  [path.join(koreanRoot, "check.mjs")],
  {
    cwd: desktopRoot,
    stdio: "inherit",
  },
);
if (check.error) throw check.error;
if (check.status !== 0) process.exit(check.status ?? 1);
const configFile = path.join(koreanRoot, "vite.config.ts");
const mode = process.argv.includes("--e2e") ? "e2e" : "production";
if (mode === "e2e") {
  process.env.VITE_BUZZ_BESTIE = "0";
  await build({ configFile, root: desktopRoot, mode });
} else {
  // Keep upstream's OSS/internal artifact inspection and Tauri's private output.
  const scratch = mkdtempSync(path.join(tmpdir(), "buzz-korean-artifacts-"));
  try {
    buildArtifactMatrix({
      selectedInternalVariant: false,
      selectedOutput:
        process.env.BUZZ_PROTECTED_BUILD_OUTPUT ??
        path.join(desktopRoot, "dist"),
      alternateOutput: path.join(scratch, "internal"),
      build: ({ internal, output }) => {
        const packagePath = fileURLToPath(
          import.meta.resolve("vite/package.json"),
        );
        const vitePackage = JSON.parse(readFileSync(packagePath, "utf8"));
        const viteEntry = path.resolve(
          path.dirname(packagePath),
          vitePackage.bin.vite,
        );
        const result = spawnSync(
          process.execPath,
          [
            viteEntry,
            "build",
            "--config",
            configFile,
            "--outDir",
            output,
            "--emptyOutDir",
          ],
          {
            cwd: desktopRoot,
            env: { ...process.env, VITE_BUZZ_BESTIE: internal ? "1" : "0" },
            stdio: "inherit",
          },
        );
        if (result.error) throw result.error;
        if (result.status !== 0)
          throw new Error(`Korean frontend build failed (${result.status})`);
      },
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
