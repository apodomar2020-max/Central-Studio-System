import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { CALENDAR_TOKENS, getCalendarCategoryTokens } from "./calendarTokens";

test("calendarTokens — provides valid tokens for class, ballet, reservation, and conflict", () => {
  assert.ok(CALENDAR_TOKENS.class.bg);
  assert.ok(CALENDAR_TOKENS.ballet.bg);
  assert.ok(CALENDAR_TOKENS.reservation.bg);
  assert.ok(CALENDAR_TOKENS.conflict.border);

  assert.equal(getCalendarCategoryTokens("class").label, "Studio class");
  assert.equal(getCalendarCategoryTokens("ballet").label, "Ballet");
  assert.equal(getCalendarCategoryTokens("reservation").label, "Private event");
});

test("calendar components — zero native browser confirm() calls exist in calendar components", () => {
  const dirPath = resolve(process.cwd(), "artifacts/admin/src/components/calendar");
  const files = readdirSync(dirPath).filter(
    (f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.endsWith(".test.ts"),
  );

  for (const file of files) {
    const content = readFileSync(resolve(dirPath, file), "utf8");
    assert.doesNotMatch(
      content,
      /\bconfirm\s*\(/,
      `File ${file} must not contain native browser confirm() calls`,
    );
  }
});

test("ReservationDetailsSheet — renders Shadcn AlertDialog for reservation cancellation confirmation", () => {
  const sheetContent = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/ReservationDetailsSheet.tsx"),
    "utf8",
  );
  assert.match(sheetContent, /<AlertDialog/);
  assert.match(sheetContent, /dialog-cancel-reservation-confirm/);
  assert.match(sheetContent, /Cancel private event\?/);
  assert.match(sheetContent, /button-confirm-cancel-reservation/);
});
