import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");
const list = read("./WebsiteNewsListPage.tsx");
const editor = read("./WebsiteNewsEditorPage.tsx");

test("Legacy News stays accessible with an explicit compatibility banner", () => {
  assert.match(list, /data-testid="legacy-news-compatibility-banner"/);
  assert.match(list, /Editorial is the primary workspace for News content/);
  assert.match(list, /compatibility metadata/);
  assert.match(list, /related-content data used by the public website/);
  assert.match(list, /useListAdminWebsiteNews\(\)/);
  assert.match(list, /button-add-news/);
  assert.match(list, /button-edit-news-\$\{post\.slug\}/);
});

test("Legacy News editor identifies the compatibility-sensitive fields without changing its save contract", () => {
  assert.match(editor, /data-testid="legacy-news-editor-guidance"/);
  assert.match(
    editor,
    /category,[\s\S]{0,80}fallback subtitle,[\s\S]{0,80}display date,[\s\S]{0,80}related-content references/,
  );
  assert.match(editor, /useCreateWebsiteNewsPost\(\)/);
  assert.match(editor, /useUpdateWebsiteNewsPost\(\)/);
  assert.match(editor, /button-save-news/);
});

test("Legacy News deactivation warns about the actual compatibility effect and keeps soft-deactivation", () => {
  assert.match(list, /useDeactivateWebsiteNewsPost\(\)/);
  assert.match(
    list,
    /may affect compatibility metadata and related-content references/,
  );
  assert.match(
    list,
    /does not reliably remove the migrated Editorial News post from public News pages/,
  );
  assert.match(list, /confirmLabel: "Deactivate"/);
  assert.match(list, /deactivatePost\.mutate\(/);
});
