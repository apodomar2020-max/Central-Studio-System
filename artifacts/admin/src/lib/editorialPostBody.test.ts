/**
 * Wave 2.1D — body block model.
 *
 * Real behaviour tests against the real module (node --test
 * --experimental-strip-types), matching the Wave 2.1B/2.1C convention.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BLOCK_TYPE_DEFINITIONS,
  MAX_BODY_BLOCKS,
  MAX_HEADING_CHARS,
  MAX_IMAGE_ALT_CHARS,
  MAX_IMAGE_BLOCKS,
  MAX_IMAGE_CAPTION_CHARS,
  MAX_LIST_ITEMS,
  MAX_LIST_ITEM_CHARS,
  MAX_PARAGRAPH_CHARS,
  MAX_QUOTE_ATTRIBUTION_CHARS,
  MAX_QUOTE_ATTRIBUTION_ROLE_CHARS,
  MAX_QUOTE_CHARS,
  MIN_LIST_ITEMS,
  addBlock,
  addListItem,
  blockCapMessage,
  canAddBlock,
  countImageBlocks,
  createBlock,
  deleteLabel,
  firstFieldOf,
  focusIndexAfterDelete,
  moveBlockDown,
  moveBlockUp,
  moveDownLabel,
  moveUpLabel,
  nextBlockKey,
  removeBlock,
  removeListItem,
  setListItem,
  stripKey,
  toBodyPayload,
  toEditableBlocks,
  updateBlock,
  validateBlock,
  validateBody,
  type EditableBlock,
} from "./editorial-post-body.ts";

const serverBody = readFileSync(
  new URL("../../../api-server/src/lib/editorialBody.ts", import.meta.url),
  "utf8",
);

// ─── Limits are pinned against the real server schema ────────────────────────

test("every limit matches artifacts/api-server/src/lib/editorialBody.ts exactly", () => {
  const pins: Array<[string, number]> = [
    ["MAX_BODY_BLOCKS", MAX_BODY_BLOCKS],
    ["MAX_IMAGE_BLOCKS", MAX_IMAGE_BLOCKS],
    ["MAX_PARAGRAPH_CHARS", MAX_PARAGRAPH_CHARS],
    ["MAX_HEADING_CHARS", MAX_HEADING_CHARS],
    ["MAX_IMAGE_ALT_CHARS", MAX_IMAGE_ALT_CHARS],
    ["MAX_IMAGE_CAPTION_CHARS", MAX_IMAGE_CAPTION_CHARS],
    ["MIN_LIST_ITEMS", MIN_LIST_ITEMS],
    ["MAX_LIST_ITEMS", MAX_LIST_ITEMS],
    ["MAX_LIST_ITEM_CHARS", MAX_LIST_ITEM_CHARS],
    // Final Editorial, Phase A — the quote caps are pinned the same way.
    ["MAX_QUOTE_CHARS", MAX_QUOTE_CHARS],
    ["MAX_QUOTE_ATTRIBUTION_CHARS", MAX_QUOTE_ATTRIBUTION_CHARS],
    ["MAX_QUOTE_ATTRIBUTION_ROLE_CHARS", MAX_QUOTE_ATTRIBUTION_ROLE_CHARS],
  ];
  for (const [name, value] of pins) {
    const match = serverBody.match(new RegExp(`export const ${name} = ([0-9_]+);`));
    assert.ok(match, `${name} not found in the server schema`);
    assert.equal(Number(match![1]!.replace(/_/g, "")), value, `${name} drifted from the server`);
  }
});

test("FIVE block types are implemented — Quote landed in Final Editorial, Phase A", () => {
  // Wave 2.1D deferred Quote (D1) and documented the extension path. Phase A
  // took it, so this now asserts the CURRENT set rather than the deferral.
  assert.deepEqual(
    BLOCK_TYPE_DEFINITIONS.map((definition) => definition.type),
    ["paragraph", "heading", "image", "bulleted-list", "quote"],
  );
  // Quote is appended LAST, so no existing toolbar position moved.
  assert.equal(BLOCK_TYPE_DEFINITIONS.at(-1)!.label, "Add quote");
  assert.equal(BLOCK_TYPE_DEFINITIONS.at(-1)!.noun, "Quote");
  // And the client's union is not ahead of the server's: the server really
  // does carry a quote member of its discriminated union.
  const union = serverBody.slice(serverBody.indexOf("export const editorialBodyBlockSchema"));
  assert.match(union, /quoteBlockSchema/);
});

test("quote: a new block starts blank with BOTH attribution fields controlled", () => {
  const block = createBlock("quote") as unknown as {
    type: string; text: string; attribution: string; attributionRole: string;
  };
  assert.equal(block.type, "quote");
  assert.equal(block.text, "");
  // "" rather than undefined, so the inputs never flip controlled→uncontrolled.
  assert.equal(block.attribution, "");
  assert.equal(block.attributionRole, "");
});

test("quote: text is REQUIRED and capped, with the SERVER's messages verbatim", () => {
  const problems = validateBlock({ type: "quote", text: "" } as never, 3);
  assert.deepEqual(problems, [
    { index: 3, field: "text", message: "A quote block needs the quoted text." },
  ]);
  assert.match(serverBody, /A quote block needs the quoted text\./);

  const long = validateBlock({ type: "quote", text: "q".repeat(MAX_QUOTE_CHARS + 1) } as never, 0);
  assert.deepEqual(long, [
    { index: 0, field: "text", message: `A quote block cannot exceed ${MAX_QUOTE_CHARS} characters.` },
  ]);
  assert.match(serverBody, /A quote block cannot exceed \$\{MAX_QUOTE_CHARS\} characters\./);
  // Exactly at the cap is valid — the boundary is inclusive on both sides.
  assert.deepEqual(validateBlock({ type: "quote", text: "q".repeat(MAX_QUOTE_CHARS) } as never, 0), []);
});

test("quote: both attribution fields are optional and INDEPENDENTLY capped", () => {
  assert.deepEqual(validateBlock({ type: "quote", text: "ok" } as never, 0), []);
  assert.deepEqual(
    validateBlock({ type: "quote", text: "ok", attribution: "Nadia", attributionRole: "AD" } as never, 0),
    [],
  );
  assert.deepEqual(
    validateBlock({ type: "quote", text: "ok", attribution: "a".repeat(MAX_QUOTE_ATTRIBUTION_CHARS + 1) } as never, 1),
    [{
      index: 1,
      field: "attribution",
      message: `A quote attribution cannot exceed ${MAX_QUOTE_ATTRIBUTION_CHARS} characters.`,
    }],
  );
  assert.deepEqual(
    validateBlock({ type: "quote", text: "ok", attributionRole: "r".repeat(MAX_QUOTE_ATTRIBUTION_ROLE_CHARS + 1) } as never, 1),
    [{
      index: 1,
      field: "attributionRole",
      message: `A quote attribution role cannot exceed ${MAX_QUOTE_ATTRIBUTION_ROLE_CHARS} characters.`,
    }],
  );
  assert.match(serverBody, /A quote attribution cannot exceed/);
  assert.match(serverBody, /A quote attribution role cannot exceed/);
});

test("quote: every problem on one block is reported at once, not one at a time", () => {
  const problems = validateBlock(
    {
      type: "quote",
      text: "",
      attribution: "a".repeat(MAX_QUOTE_ATTRIBUTION_CHARS + 1),
      attributionRole: "r".repeat(MAX_QUOTE_ATTRIBUTION_ROLE_CHARS + 1),
    } as never,
    0,
  );
  assert.deepEqual(problems.map((problem) => problem.field), ["text", "attribution", "attributionRole"]);
});

test("quote: a BLANK attribution is OMITTED from the payload, never sent as an empty string", () => {
  assert.deepEqual(
    stripKey({ key: "k1", type: "quote", text: "The stage remembers.", attribution: "", attributionRole: "" } as never),
    { type: "quote", text: "The stage remembers." },
  );
  assert.deepEqual(
    stripKey({ key: "k2", type: "quote", text: "Named.", attribution: "  Nadia Farouk  ", attributionRole: "" } as never),
    { type: "quote", text: "Named.", attribution: "Nadia Farouk" },
  );
  assert.deepEqual(
    stripKey({ key: "k3", type: "quote", text: "Role only.", attribution: "   ", attributionRole: " Artistic Director " } as never),
    { type: "quote", text: "Role only.", attributionRole: "Artistic Director" },
  );
  assert.deepEqual(
    stripKey({ key: "k4", type: "quote", text: "Both.", attribution: "Nadia", attributionRole: "AD" } as never),
    { type: "quote", text: "Both.", attribution: "Nadia", attributionRole: "AD" },
  );
});

test("quote: a quote participates in the whole-body sweep like every other type", () => {
  const blocks = [
    { key: "a", type: "paragraph", text: "fine" },
    { key: "b", type: "quote", text: "" },
  ] as unknown as EditableBlock[];
  const problems = validateBody(blocks);
  assert.deepEqual(problems, [
    { index: 1, field: "text", message: "A quote block needs the quoted text." },
  ]);
  // And it survives a full payload round-trip with the others.
  assert.deepEqual(
    toBodyPayload([
      { key: "a", type: "paragraph", text: "fine" },
      { key: "b", type: "quote", text: "Said it.", attribution: "Nadia", attributionRole: "" },
    ] as unknown as EditableBlock[]),
    { blocks: [
      { type: "paragraph", text: "fine" },
      { type: "quote", text: "Said it.", attribution: "Nadia" },
    ] },
  );
});

test("quote: reorder, delete and key stability work with no quote-specific code", () => {
  const blocks = [
    createBlock("paragraph"),
    createBlock("quote"),
    createBlock("heading"),
  ];
  const quoteKey = blocks[1]!.key;
  const up = moveBlockUp(blocks, 1);
  assert.equal(up[0]!.key, quoteKey, "the moved quote keeps its key — React must not remount it");
  assert.equal(up[0]!.type, "quote");
  const down = moveBlockDown(up, 0);
  assert.deepEqual(down.map((block) => block.type), ["paragraph", "quote", "heading"]);
  assert.deepEqual(removeBlock(blocks, 1).map((block) => block.type), ["paragraph", "heading"]);
  // The generic caps and nouns pick quote up with no extra wiring.
  assert.equal(blockCapMessage !== undefined, true);
  assert.equal(countImageBlocks(blocks), 0);
});

// ─── Keys ────────────────────────────────────────────────────────────────────

test("local keys are unique and never collide within one tick", () => {
  const keys = new Set(Array.from({ length: 500 }, () => nextBlockKey()));
  assert.equal(keys.size, 500);
});

test("toEditableBlocks mints one key per stored block and preserves content", () => {
  const blocks = toEditableBlocks({
    blocks: [
      { type: "paragraph", text: "one" },
      { type: "heading", level: 3, text: "two" },
    ],
  });
  assert.equal(blocks.length, 2);
  assert.notEqual(blocks[0]!.key, blocks[1]!.key);
  assert.equal(blocks[0]!.type, "paragraph");
  assert.equal((blocks[1] as { level: number }).level, 3);
});

test("an unrecognised block type is preserved, never dropped", () => {
  // The example used to be "quote", which is now a REAL type — so this uses
  // a genuinely unknown one, or it would no longer be testing the fallback.
  const blocks = toEditableBlocks({ blocks: [{ type: "embed", url: "https://example.com" }] } as never);
  assert.equal(blocks.length, 1);
  assert.equal((blocks[0] as unknown as { type: string }).type, "embed");
});

test("a STORED quote round-trips through toEditableBlocks with its attributions intact", () => {
  const blocks = toEditableBlocks({
    blocks: [{ type: "quote", text: "The stage remembers.", attribution: "Nadia", attributionRole: "AD" }],
  } as never);
  assert.equal(blocks.length, 1);
  const block = blocks[0] as unknown as { type: string; text: string; attribution: string; attributionRole: string };
  assert.equal(block.type, "quote");
  assert.equal(block.text, "The stage remembers.");
  assert.equal(block.attribution, "Nadia");
  assert.equal(block.attributionRole, "AD");
  assert.ok(blocks[0]!.key, "a local key is minted for it like any other block");
});

test("a null or empty body yields zero blocks", () => {
  assert.equal(toEditableBlocks(null).length, 0);
  assert.equal(toEditableBlocks({ blocks: [] }).length, 0);
});

// ─── Factories ───────────────────────────────────────────────────────────────

test("a new heading defaults to level 2 — the title is the page h1", () => {
  const block = createBlock("heading");
  assert.equal((block as { level: number }).level, 2);
});

test("a new bulleted list starts at the server minimum, not at one item", () => {
  const block = createBlock("bulleted-list") as EditableBlock & { items: string[] };
  assert.equal(block.items.length, MIN_LIST_ITEMS);
});

test("a new image block has empty url/alt/caption", () => {
  const block = createBlock("image") as EditableBlock & { url: string; alt: string };
  assert.equal(block.url, "");
  assert.equal(block.alt, "");
});

// ─── Add / remove / move ─────────────────────────────────────────────────────

test("addBlock appends by default and inserts at an index when asked", () => {
  let blocks = addBlock([], "paragraph");
  blocks = addBlock(blocks, "heading");
  assert.deepEqual(blocks.map((b) => b.type), ["paragraph", "heading"]);
  blocks = addBlock(blocks, "image", 1);
  assert.deepEqual(blocks.map((b) => b.type), ["paragraph", "image", "heading"]);
});

test("addBlock clamps an out-of-range index instead of producing holes", () => {
  const blocks = addBlock(addBlock([], "paragraph"), "heading", 99);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1]!.type, "heading");
});

test("removeBlock removes exactly one block and is a no-op out of range", () => {
  let blocks = addBlock(addBlock(addBlock([], "paragraph"), "heading"), "image");
  blocks = removeBlock(blocks, 1);
  assert.deepEqual(blocks.map((b) => b.type), ["paragraph", "image"]);
  assert.equal(removeBlock(blocks, 9).length, 2);
  assert.equal(removeBlock(blocks, -1).length, 2);
});

test("move up and move down reorder by one and are no-ops at the ends", () => {
  const blocks = addBlock(addBlock(addBlock([], "paragraph"), "heading"), "image");
  assert.deepEqual(moveBlockUp(blocks, 2).map((b) => b.type), ["paragraph", "image", "heading"]);
  assert.deepEqual(moveBlockDown(blocks, 0).map((b) => b.type), ["heading", "paragraph", "image"]);
  assert.deepEqual(moveBlockUp(blocks, 0).map((b) => b.type), blocks.map((b) => b.type));
  assert.deepEqual(moveBlockDown(blocks, 2).map((b) => b.type), blocks.map((b) => b.type));
});

test("moving a block keeps its key — React must not remount the field being moved", () => {
  const blocks = addBlock(addBlock([], "paragraph"), "heading");
  const movedKey = blocks[1]!.key;
  assert.equal(moveBlockUp(blocks, 1)[0]!.key, movedKey);
});

test("every mutation is pure — the input array is never modified", () => {
  const blocks = addBlock(addBlock([], "paragraph"), "heading");
  const snapshot = blocks.map((b) => b.type).join();
  removeBlock(blocks, 0);
  moveBlockUp(blocks, 1);
  updateBlock(blocks, 0, { text: "x" } as never);
  assert.equal(blocks.map((b) => b.type).join(), snapshot);
});

// ─── List items ──────────────────────────────────────────────────────────────

test("list items add, set and remove — but never below the server minimum", () => {
  let blocks = addBlock([], "bulleted-list");
  blocks = setListItem(blocks, 0, 0, "first");
  blocks = addListItem(blocks, 0);
  assert.deepEqual((blocks[0] as never as { items: string[] }).items, ["first", "", ""]);
  blocks = removeListItem(blocks, 0, 2);
  assert.equal((blocks[0] as never as { items: string[] }).items.length, 2);
  blocks = removeListItem(blocks, 0, 1);
  assert.equal(
    (blocks[0] as never as { items: string[] }).items.length,
    MIN_LIST_ITEMS,
    "removing below the minimum must be refused",
  );
});

test("addListItem refuses to exceed the maximum", () => {
  let blocks = addBlock([], "bulleted-list");
  for (let i = 0; i < MAX_LIST_ITEMS + 5; i += 1) blocks = addListItem(blocks, 0);
  assert.equal((blocks[0] as never as { items: string[] }).items.length, MAX_LIST_ITEMS);
});

// ─── Caps ────────────────────────────────────────────────────────────────────

test("canAddBlock enforces the whole-body cap and the image cap independently", () => {
  const paragraphs = Array.from({ length: MAX_BODY_BLOCKS }, () => ({ type: "paragraph" }));
  assert.equal(canAddBlock(paragraphs, "paragraph"), false);
  const images = Array.from({ length: MAX_IMAGE_BLOCKS }, () => ({ type: "image" }));
  assert.equal(canAddBlock(images, "image"), false);
  assert.equal(canAddBlock(images, "paragraph"), true, "the image cap must not block a paragraph");
  assert.equal(countImageBlocks(images), MAX_IMAGE_BLOCKS);
});

test("blockCapMessage uses the server's own wording", () => {
  const images = Array.from({ length: MAX_IMAGE_BLOCKS }, () => ({ type: "image" }));
  assert.equal(blockCapMessage(images), `A post cannot have more than ${MAX_IMAGE_BLOCKS} image blocks.`);
  assert.ok(serverBody.includes("A post cannot have more than ${MAX_IMAGE_BLOCKS} image blocks."));
  assert.equal(blockCapMessage([]), null);
});

// ─── Validation, per type ────────────────────────────────────────────────────

test("paragraph: empty and over-long both rejected with the server's messages", () => {
  assert.equal(validateBlock({ type: "paragraph", text: "" }, 0)[0]!.message, "A paragraph block cannot be empty.");
  assert.equal(
    validateBlock({ type: "paragraph", text: "x".repeat(MAX_PARAGRAPH_CHARS + 1) }, 0)[0]!.message,
    `A paragraph block cannot exceed ${MAX_PARAGRAPH_CHARS} characters.`,
  );
  assert.deepEqual(validateBlock({ type: "paragraph", text: "ok" }, 0), []);
});

test("heading: level must be 2 or 3, text 1..150", () => {
  assert.equal(
    validateBlock({ type: "heading", level: 4 as never, text: "x" }, 0)[0]!.message,
    "A heading block's level must be 2 or 3.",
  );
  assert.equal(
    validateBlock({ type: "heading", level: 2, text: "" }, 0)[0]!.message,
    "A heading block cannot be empty.",
  );
  assert.equal(
    validateBlock({ type: "heading", level: 3, text: "x".repeat(MAX_HEADING_CHARS + 1) }, 0)[0]!.message,
    `A heading block cannot exceed ${MAX_HEADING_CHARS} characters.`,
  );
});

test("image: alt is REQUIRED on every write, not only at publish", () => {
  const problems = validateBlock(
    { type: "image", url: "https://images.unsplash.com/a.jpg", alt: "   " },
    0,
  );
  assert.equal(problems.length, 1);
  assert.equal(problems[0]!.field, "alt");
  assert.equal(problems[0]!.message, "Every image block needs alt text.");
  assert.ok(serverBody.includes("Every image block needs alt text."));
});

test("image: url must parse and must be https; the host allowlist is NOT replicated", () => {
  assert.equal(validateBlock({ type: "image", url: "not a url", alt: "a" }, 0)[0]!.field, "url");
  assert.equal(
    validateBlock({ type: "image", url: "http://images.unsplash.com/a.jpg", alt: "a" }, 0)[0]!.message,
    "The link must start with https://",
  );
  // An unknown-but-valid https host is accepted client-side on purpose —
  // the server owns the allowlist.
  assert.deepEqual(validateBlock({ type: "image", url: "https://elsewhere.test/a.jpg", alt: "a" }, 0), []);
});

test("image: caption is optional but capped", () => {
  assert.deepEqual(
    validateBlock({ type: "image", url: "https://a.test/b.jpg", alt: "a" }, 0),
    [],
  );
  assert.equal(
    validateBlock(
      { type: "image", url: "https://a.test/b.jpg", alt: "a", caption: "x".repeat(MAX_IMAGE_CAPTION_CHARS + 1) },
      0,
    )[0]!.message,
    `An image caption cannot exceed ${MAX_IMAGE_CAPTION_CHARS} characters.`,
  );
});

test("bulleted-list: min, max and per-item rules", () => {
  assert.equal(
    validateBlock({ type: "bulleted-list", items: ["only"] }, 0)[0]!.message,
    `A bulleted list needs at least ${MIN_LIST_ITEMS} items.`,
  );
  assert.equal(
    validateBlock({ type: "bulleted-list", items: Array.from({ length: MAX_LIST_ITEMS + 1 }, () => "x") }, 0)[0]!.message,
    `A bulleted list cannot exceed ${MAX_LIST_ITEMS} items.`,
  );
  assert.equal(
    validateBlock({ type: "bulleted-list", items: ["a", ""] }, 0)[0]!.message,
    "A list item cannot be empty.",
  );
  assert.equal(
    validateBlock({ type: "bulleted-list", items: ["a", "x".repeat(MAX_LIST_ITEM_CHARS + 1)] }, 0)[0]!.message,
    `A list item cannot exceed ${MAX_LIST_ITEM_CHARS} characters.`,
  );
  assert.deepEqual(validateBlock({ type: "bulleted-list", items: ["a", "b"] }, 0), []);
});

test("validateBody reports whole-body caps with index -1", () => {
  const overflow = Array.from({ length: MAX_BODY_BLOCKS + 1 }, () => ({
    key: nextBlockKey(),
    type: "paragraph" as const,
    text: "x",
  }));
  const problems = validateBody(overflow);
  assert.ok(problems.some((p) => p.index === -1 && p.message.includes(String(MAX_BODY_BLOCKS))));
});

// ─── Payload stripping ───────────────────────────────────────────────────────

test("toBodyPayload strips every client-only key", () => {
  const blocks = toEditableBlocks({
    blocks: [
      { type: "paragraph", text: "a" },
      { type: "image", url: "https://a.test/b.jpg", alt: "alt" },
      { type: "bulleted-list", items: ["a", "b"] },
    ],
  });
  const payload = toBodyPayload(blocks);
  assert.equal(JSON.stringify(payload).includes('"key"'), false);
  assert.equal(payload.blocks.length, 3);
});

test("a blank image caption is OMITTED, not sent as an empty string", () => {
  const stripped = stripKey({ key: "k", type: "image", url: " https://a.test/b.jpg ", alt: " alt ", caption: "  " });
  assert.deepEqual(stripped, { type: "image", url: "https://a.test/b.jpg", alt: "alt" });
  assert.equal("caption" in stripped, false);
});

test("a real image caption survives, trimmed", () => {
  const stripped = stripKey({ key: "k", type: "image", url: "https://a.test/b.jpg", alt: "alt", caption: " cap " });
  assert.equal((stripped as { caption?: string }).caption, "cap");
});

// ─── Focus management ────────────────────────────────────────────────────────

test("focus after delete lands on the replacement, the new last block, or the toolbar", () => {
  assert.equal(focusIndexAfterDelete(0, 3), 0, "the block that took its place");
  assert.equal(focusIndexAfterDelete(3, 3), 2, "deleting the last block falls back one");
  assert.equal(focusIndexAfterDelete(0, 0), null, "an empty list focuses the insert toolbar");
});

test("the first focusable field differs per type", () => {
  assert.equal(firstFieldOf("paragraph"), "text");
  assert.equal(firstFieldOf("heading"), "text");
  assert.equal(firstFieldOf("image"), "url");
  assert.equal(firstFieldOf("bulleted-list"), "item-0");
  assert.equal(firstFieldOf("quote"), "text", "quote falls through to its first field");
});

test("move and delete labels are descriptive and 1-based for screen readers", () => {
  assert.equal(moveUpLabel(0, "paragraph"), "Move paragraph block 1 up");
  assert.equal(moveDownLabel(2, "image"), "Move image block 3 down");
  assert.equal(deleteLabel(1, "bulleted-list"), "Delete bulleted list block 2");
});

// ─── No drag-and-drop was introduced ─────────────────────────────────────────

test("reordering is keyboard-operable buttons only — no dnd library is referenced", () => {
  const source = readFileSync(new URL("./editorial-post-body.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /dnd-kit|react-beautiful-dnd|draggable|onDragStart/i);
});
