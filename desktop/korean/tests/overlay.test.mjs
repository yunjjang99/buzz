import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { checkOverlay, desktopRoot, transformSource } from "../overlay.mjs";

const filename = path.join(
  desktopRoot,
  "src/features/sidebar/ui/SidebarSection.tsx",
);
const source = readFileSync(filename, "utf8");

test("all current UI bindings apply without modifying source", () => {
  assert.equal(checkOverlay(), 25);
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
