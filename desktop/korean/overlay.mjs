import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatch, parsePatch } from "diff";

export const koreanRoot = path.dirname(fileURLToPath(import.meta.url));
export const desktopRoot = path.dirname(koreanRoot);
export const manifest = JSON.parse(
  readFileSync(path.join(koreanRoot, "manifest.json"), "utf8"),
);
const entries = new Map(
  manifest.files.map((entry) => [path.join(desktopRoot, entry.file), entry]),
);

/** Apply only exact, unambiguous contexts; never write upstream source files. */
export function transformSource(source, filename) {
  const entry = entries.get(path.resolve(filename));
  if (!entry) return source;
  const patch = readFileSync(
    path.join(koreanRoot, "patches", entry.patch),
    "utf8",
  );
  for (const hunk of parsePatch(patch)[0].hunks) {
    const context = `${hunk.lines
      .filter((line) => line[0] === " " || line[0] === "-")
      .map((line) => line.slice(1))
      .join("\n")}\n`;
    const first = source.indexOf(context);
    if (first === -1 || source.indexOf(context, first + 1) !== -1) {
      throw new Error(
        `Korean overlay requires review: ${entry.file}, original line ${hunk.oldStart}. ` +
          "Upstream context changed or is ambiguous. Update the overlay before building; upstream source was not changed.",
      );
    }
  }
  const result = applyPatch(source, patch, { fuzzFactor: 0 });
  if (result === false) throw new Error(`Korean overlay failed: ${entry.file}`);
  return result;
}

/** Check every binding, including files not reached by a particular bundle. */
export function checkOverlay(
  readSource = (filename) => readFileSync(filename, "utf8"),
) {
  for (const filename of entries.keys()) {
    transformSource(readSource(filename), filename);
  }
  return entries.size;
}

export function koreanPlugin() {
  return {
    name: "buzz-korean-ui",
    enforce: "pre",
    buildStart() {
      checkOverlay();
    },
    transform(source, id) {
      const filename = id.split("?")[0];
      if (!entries.has(filename)) return null;
      return { code: transformSource(source, filename), map: null };
    },
  };
}
