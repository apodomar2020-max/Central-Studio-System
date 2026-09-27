/**
 * Final Editorial, Phase B — the translation gallery's Admin model.
 *
 * Real behaviour tests against the real module (node --test
 * --experimental-strip-types), matching the editorialPostBody.test.ts
 * convention.
 *
 * Two things are under test. The ordinary one is that add / remove / move
 * / edit behave. The one that matters is the BOUNDARY: `key` is a
 * client-only list identity, and exactly one function is allowed to strip
 * it. If a key ever crossed into a payload it would be stored in the
 * database's jsonb forever and would make every subsequent comparison
 * wrong.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EMPTY_GALLERY,
  MAX_GALLERY_ALT_CHARS,
  MAX_GALLERY_ITEMS,
  addGalleryItem,
  canAddGalleryItem,
  createGalleryItem,
  galleryCapMessage,
  galleryProblemFor,
  moveGalleryItemDown,
  moveGalleryItemUp,
  removeGalleryItem,
  stripGalleryKey,
  toEditableGalleryItems,
  toGalleryPayload,
  updateGalleryItem,
  validateGallery,
  type EditableGalleryItem,
} from "./editorial-post-gallery.ts";

function items(...pairs: Array<[string, string]>): EditableGalleryItem[] {
  return pairs.map(([url, alt], index) => ({ key: `k${index}`, url, alt }));
}

// ─── Reading a stored gallery ────────────────────────────────────────────────

test("an absent or malformed gallery reads as EMPTY, never as a crash", () => {
  // A revision snapshot written before migration 0129 physically cannot
  // carry the key, and restore must read that absence as the empty gallery
  // the column would have held at the time.
  assert.deepEqual(toEditableGalleryItems(undefined), []);
  assert.deepEqual(toEditableGalleryItems(null), []);
  assert.deepEqual(toEditableGalleryItems({} as never), []);
  assert.deepEqual(toEditableGalleryItems({ items: "nope" } as never), []);
});

test("reading a stored gallery preserves order and gives each item a list key", () => {
  const read = toEditableGalleryItems({ items: [{ url: "a", alt: "A" }, { url: "b", alt: "B" }] });
  assert.deepEqual(read.map((item) => item.url), ["a", "b"]);
  assert.equal(new Set(read.map((item) => item.key)).size, 2, "keys must be unique");
});

// ─── The client-only key boundary ────────────────────────────────────────────

test("the list key NEVER reaches a payload", () => {
  const payload = toGalleryPayload(items(["https://x.test/a.jpg", "A"]));
  assert.deepEqual(payload, { items: [{ url: "https://x.test/a.jpg", alt: "A" }] });
  assert.equal("key" in payload.items[0], false);
});

test("stripping is the single trimming point, so whitespace never reaches storage", () => {
  assert.deepEqual(stripGalleryKey({ key: "k", url: "  u  ", alt: "  a  " }), { url: "u", alt: "a" });
});

test("only ONE function in the module strips the key", () => {
  // Read from the source rather than asserted by behaviour: a second
  // stripping site is exactly how a client-only field eventually leaks.
  const source = readFileSync(new URL("./editorial-post-gallery.ts", import.meta.url), "utf8");
  const constructions = source.match(/\{\s*url:\s*item\.url/g) ?? [];
  assert.equal(constructions.length, 1, "there must be exactly one place a payload item is constructed");
});

// ─── Ordering ────────────────────────────────────────────────────────────────

test("moving an item up and down changes the ORDER, which is the display order", () => {
  const list = items(["a", "A"], ["b", "B"], ["c", "C"]);
  assert.deepEqual(moveGalleryItemUp(list, 2).map((i) => i.url), ["a", "c", "b"]);
  assert.deepEqual(moveGalleryItemDown(list, 0).map((i) => i.url), ["b", "a", "c"]);
});

test("moving past either end is a no-op rather than an error", () => {
  const list = items(["a", "A"], ["b", "B"]);
  assert.deepEqual(moveGalleryItemUp(list, 0).map((i) => i.url), ["a", "b"]);
  assert.deepEqual(moveGalleryItemDown(list, 1).map((i) => i.url), ["a", "b"]);
});

test("a pure reorder changes the payload, because the array order IS the order", () => {
  const list = items(["a", "A"], ["b", "B"]);
  assert.notDeepEqual(toGalleryPayload(moveGalleryItemUp(list, 1)), toGalleryPayload(list));
});

// ─── Add / remove / update ───────────────────────────────────────────────────

test("adding appends a blank item and removing takes one out", () => {
  const one = addGalleryItem([]);
  assert.equal(one.length, 1);
  assert.deepEqual(removeGalleryItem(one, 0), []);
});

test("each created item gets a distinct key", () => {
  const keys = new Set([createGalleryItem().key, createGalleryItem().key, createGalleryItem().key]);
  assert.equal(keys.size, 3);
});

test("updating one item leaves its siblings untouched", () => {
  const list = items(["a", "A"], ["b", "B"]);
  const next = updateGalleryItem(list, 1, { alt: "B2" });
  assert.deepEqual(next.map((i) => i.alt), ["A", "B2"]);
  assert.equal(next[0], list[0], "an untouched item should not be recreated");
});

// ─── The cap ─────────────────────────────────────────────────────────────────

test("the item cap matches the server's and is announced before it is hit", () => {
  const full = Array.from({ length: MAX_GALLERY_ITEMS }, (_, i) => ({ key: `k${i}`, url: "u", alt: "a" }));
  assert.equal(canAddGalleryItem(full), false);
  assert.equal(canAddGalleryItem(full.slice(0, -1)), true);
  assert.match(galleryCapMessage(full) ?? "", new RegExp(String(MAX_GALLERY_ITEMS)));
  assert.equal(galleryCapMessage([]), null);
});

// ─── Validation mirrors the server ───────────────────────────────────────────

test("alt text is REQUIRED on every item, not only at publish", () => {
  const problems = validateGallery(items(["https://x.test/a.jpg", ""]));
  assert.equal(galleryProblemFor(problems, 0, "alt"), "Every gallery image needs alt text.");
});

test("whitespace-only alt text is not alt text", () => {
  const problems = validateGallery(items(["https://x.test/a.jpg", "   "]));
  assert.equal(galleryProblemFor(problems, 0, "alt"), "Every gallery image needs alt text.");
});

test("a blank url is reported against the url field", () => {
  const problems = validateGallery(items(["", "Some alt."]));
  assert.equal(galleryProblemFor(problems, 0, "url"), "A gallery item's url must be a valid URL.");
});

test("over-long alt text is reported with the same limit the server enforces", () => {
  const problems = validateGallery(items(["https://x.test/a.jpg", "x".repeat(MAX_GALLERY_ALT_CHARS + 1)]));
  assert.match(galleryProblemFor(problems, 0, "alt") ?? "", new RegExp(String(MAX_GALLERY_ALT_CHARS)));
});

test("problems are reported per index, so the right row highlights", () => {
  const problems = validateGallery(items(["https://x.test/a.jpg", "Fine."], ["https://x.test/b.jpg", ""]));
  assert.equal(galleryProblemFor(problems, 0, "alt"), undefined);
  assert.ok(galleryProblemFor(problems, 1, "alt"));
});

test("every validation message is the SERVER's own wording, verbatim", () => {
  // One sentence for one rule. An operator must never see one wording in
  // the editor and a different one in the 400 that follows.
  const server = readFileSync(
    new URL("../../../api-server/src/lib/editorialGallery.ts", import.meta.url),
    "utf8",
  );
  for (const message of [
    "A gallery item's url must be a valid URL.",
    "Every gallery image needs alt text.",
  ]) {
    assert.ok(server.includes(message), `server must use the exact message: ${message}`);
  }
  assert.ok(server.includes("Gallery alt text cannot exceed ${MAX_IMAGE_ALT_CHARS} characters."));
});

test("an empty gallery is the empty-items shape, matching migration 0129's default", () => {
  assert.deepEqual(EMPTY_GALLERY, { items: [] });
  assert.deepEqual(toGalleryPayload([]), { items: [] });
});
