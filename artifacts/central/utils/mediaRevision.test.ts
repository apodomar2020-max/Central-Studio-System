import assert from "node:assert/strict";
import test from "node:test";

import { withMediaRevision } from "./mediaRevision";

test("adds a revision to a plain remote image URL", () => {
  assert.equal(withMediaRevision("https://cdn.test/image.jpg", 42), "https://cdn.test/image.jpg?cs_rev=42");
});

test("preserves existing query parameters", () => {
  assert.equal(withMediaRevision("https://cdn.test/image.jpg?w=400", 42), "https://cdn.test/image.jpg?w=400&cs_rev=42");
});

test("does not alter local, absent, or unrevised media", () => {
  assert.equal(withMediaRevision("/assets/image.jpg", 42), "/assets/image.jpg");
  assert.equal(withMediaRevision("https://cdn.test/image.jpg", 0), "https://cdn.test/image.jpg");
  assert.equal(withMediaRevision(null, 42), null);
});
