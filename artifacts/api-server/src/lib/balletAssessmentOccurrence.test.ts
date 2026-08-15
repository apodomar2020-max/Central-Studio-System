import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertAssessmentOccurrenceNotExpired,
  hasAssessmentOccurrenceEnded,
} from "./balletAssessmentOccurrence";

test("past same-day assessment slot is expired in Cairo", () => {
  // 14:30Z is 17:30 in Cairo during August daylight-saving time.
  const now = new Date("2026-08-15T14:30:00.000Z");
  assert.equal(hasAssessmentOccurrenceEnded("2026-08-15", "16:00", "17:00", now), true);
});

test("future same-day assessment slot remains available in Cairo", () => {
  const now = new Date("2026-08-15T14:30:00.000Z");
  assert.equal(hasAssessmentOccurrenceEnded("2026-08-15", "18:00", "19:00", now), false);
});

test("assessment slot expires exactly at its Cairo end boundary", () => {
  // Cairo is UTC+2 in January, so 16:00 Cairo is exactly 14:00Z.
  assert.equal(
    hasAssessmentOccurrenceEnded(
      "2026-01-15",
      "15:00",
      "16:00",
      new Date("2026-01-15T14:00:00.000Z"),
    ),
    true,
  );
});

test("Cairo DST offset is used rather than a fixed UTC offset", () => {
  // Cairo is UTC+3 in August, so 16:00 Cairo is 13:00Z.
  assert.equal(
    hasAssessmentOccurrenceEnded(
      "2026-08-15",
      "15:00",
      "16:00",
      new Date("2026-08-15T13:00:00.000Z"),
    ),
    true,
  );
});

test("expired assessment submission fails with a recoverable business error", () => {
  assert.throws(
    () => assertAssessmentOccurrenceNotExpired(
      "2026-08-15",
      "16:00",
      "17:00",
      new Date("2026-08-15T14:30:00.000Z"),
    ),
    (error: unknown) => {
      const businessError = error as { status?: number; code?: string };
      return businessError.status === 422 && businessError.code === "ASSESSMENT_SLOT_EXPIRED";
    },
  );
});

test("listing and submission both enforce assessment occurrence expiry", () => {
  const routeSource = readFileSync(new URL("../routes/ballet.ts", import.meta.url), "utf8");
  const listingCheck = "hasAssessmentOccurrenceEnded(cursor, row.startTime, row.endTime, now)";
  const submitCheck = "assertAssessmentOccurrenceNotExpired(";

  assert.ok(routeSource.includes(listingCheck));
  assert.ok(routeSource.indexOf(listingCheck) < routeSource.indexOf("occurrences.push({"));
  assert.ok(routeSource.includes(submitCheck));
});
