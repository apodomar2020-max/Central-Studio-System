import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeFinanceBackfillCursor,
  encodeFinanceBackfillCursor,
  normalizeFinanceBackfillPageInfo,
} from "./financeBackfillPagination";

test("opaque cursor round-trips a stable source boundary", () => {
  const cursor = encodeFinanceBackfillCursor("bookings", 42);
  assert.equal(cursor, encodeFinanceBackfillCursor("bookings", 42));
  assert.deepEqual(decodeFinanceBackfillCursor(cursor, "bookings"), {
    family: "bookings",
    afterId: 42,
  });
  assert.doesNotMatch(cursor, /bookings|42/);
});

test("cursor validation rejects empty, oversized, malformed, and source-mismatched values", () => {
  assert.throws(() => decodeFinanceBackfillCursor(""), /invalid/);
  assert.throws(() => decodeFinanceBackfillCursor("x".repeat(257)), /invalid/);
  assert.throws(() => decodeFinanceBackfillCursor("not-base64-json"), /invalid/);
  assert.throws(
    () => decodeFinanceBackfillCursor(encodeFinanceBackfillCursor("bookings", 4), "package_orders"),
    /source does not match/,
  );
});

test("pageInfo always contains every source and derives hasNextPage from non-null cursors", () => {
  const normalized = normalizeFinanceBackfillPageInfo({ bookings: 42 });
  assert.equal(normalized.pageInfo.hasNextPage, true);
  assert.equal(typeof normalized.pageInfo.nextCursors.bookings, "string");
  assert.equal(normalized.pageInfo.nextCursors.package_orders, null);
  assert.equal(normalized.pageInfo.nextCursors.studio_walkins, null);
  assert.deepEqual(normalized.legacyNextCursors, {
    package_orders: null,
    bookings: 42,
    studio_walkins: null,
  });
});

test("empty and exhausted results use explicit nulls and never emit empty strings", () => {
  const normalized = normalizeFinanceBackfillPageInfo({});
  assert.equal(normalized.pageInfo.hasNextPage, false);
  assert.deepEqual(normalized.pageInfo.nextCursors, {
    package_orders: null,
    bookings: null,
    studio_walkins: null,
  });
  assert.ok(Object.values(normalized.pageInfo.nextCursors).every((cursor) => cursor === null));
});
