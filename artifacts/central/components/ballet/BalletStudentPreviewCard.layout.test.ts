import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./BalletStudentPreviewCard.tsx", import.meta.url), "utf8");

test("student name and compact status share one horizontal row", () => {
  const content = source.slice(source.indexOf("const content ="), source.indexOf("return (", source.indexOf("const content =")));
  const identityEnd = content.indexOf("</View>", content.indexOf("styles.identityCopy"));
  const statusStart = content.indexOf("styles.statusPill");
  assert.ok(identityEnd >= 0 && statusStart > identityEnd, "status pill must be a sibling after the name container");
  assert.match(content, /COMPACT_STATUS_LABELS\[student\.statusTone\]/);
});

test("name shrinks while the trailing status remains visible on narrow phones", () => {
  assert.match(source, /identityCopy: \{ flex: 1, minWidth: 0 \}/);
  assert.match(source, /studentName: \{[^}]*flexShrink: 1/);
  assert.match(source, /statusPill: \{ flexShrink: 0, maxWidth: "42%"/);
});
