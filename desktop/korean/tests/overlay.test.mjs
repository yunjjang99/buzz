import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";
import {
  checkOverlay,
  desktopRoot,
  transformSource,
  manifest,
} from "../overlay.mjs";

const filename = path.join(
  desktopRoot,
  "src/features/sidebar/ui/SidebarSection.tsx",
);
const source = readFileSync(filename, "utf8");

test("all current UI bindings apply without modifying source", () => {
  assert.equal(checkOverlay(), manifest.files.length);
  const result = transformSource(source, filename);
  assert.ok(result.includes("@buzz-korean/locale"));
  assert.ok(result.includes("useLocale()"));
  assert.equal(readFileSync(filename, "utf8"), source);
});

test("upstream line shifts and unrelated additions survive", () => {
  const prefix = "// Upstream added a comment above this file.\n";
  assert.ok(transformSource(prefix + source, filename).startsWith(prefix));
  const unrelated = "export const unrelatedUpstreamValue = 42;\n";
  assert.ok(transformSource(source + unrelated, filename).endsWith(unrelated));
});

test("changed or duplicated integration context stops the production transform", () => {
  const changed = source.replace(
    'aria-label="Close direct message"',
    'aria-label="Dismiss direct message"',
  );
  assert.notEqual(changed, source);
  assert.throws(() => transformSource(changed, filename), /requires review/);
  assert.throws(() => transformSource(source + source, filename), /ambiguous/);
});

test("relay and unrelated UI are never transformed", () => {
  assert.equal(
    transformSource(
      "unchanged",
      path.join(desktopRoot, "../crates/buzz-relay/src/main.rs"),
    ),
    "unchanged",
  );
  assert.equal(
    transformSource(
      "user message",
      path.join(desktopRoot, "src/features/messages/ui/MessageBubble.tsx"),
    ),
    "user message",
  );
});

// Module-level translation captures the startup language permanently. Static
// option records must defer translation with getters or at their render site.
test("translated options resolve the current language instead of capturing it at import", () => {
  const frozen = [];
  for (const { file } of manifest.files) {
    const filename = path.join(desktopRoot, file);
    const transformed = transformSource(
      readFileSync(filename, "utf8"),
      filename,
    );
    const ast = ts.createSourceFile(
      file,
      transformed,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === "t") {
        let parent = node.parent;
        while (parent && !ts.isFunctionLike(parent)) parent = parent.parent;
        if (!parent) frozen.push(`${file}: ${node.getText(ast)}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  assert.deepEqual(frozen, []);
});
