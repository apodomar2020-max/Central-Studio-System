import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");
const list = read("./WebsiteNewsListPage.tsx");
const editor = read("./WebsiteNewsEditorPage.tsx");

test("Legacy News stays accessible as a local Editorial Compatibility workspace", () => {
  assert.match(list, /<EditorialWorkspaceNav \/>/);
  assert.doesNotMatch(list, /legacy-news-compatibility-banner/);
  assert.match(list, /useListAdminWebsiteNews\(\)/);
  assert.match(list, /button-add-news/);
  assert.match(list, /button-edit-news-\$\{post\.slug\}/);
});

test("Legacy News editor keeps compatibility help local to sensitive fields without changing its save contract", () => {
  assert.match(editor, /<EditorialWorkspaceNav \/>/);
  assert.doesNotMatch(editor, /legacy-news-editor-guidance/);
  assert.match(editor, /input-news-category[\s\S]{0,180}migrated public News compatibility/);
  assert.match(editor, /input-news-category-label[\s\S]{0,180}migrated public News compatibility/);
  assert.match(editor, /input-news-subtitle[\s\S]{0,180}fallback subtitle by migrated public News/);
  assert.match(editor, /input-news-published-date[\s\S]{0,180}legacy display date for migrated public News/);
  assert.match(editor, /Related Content[\s\S]{0,420}used by migrated public News/);
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
