import assert from "node:assert/strict";
import test from "node:test";

import { isVisibleUpcomingMyBooking } from "./myBookingsVisibility";

const NOW = Date.parse("2026-08-27T00:00:00.000Z");
const base = {
  bookingStatus: "confirmed",
  occurrenceDate: "2026-08-28",
  scheduleStartTime: "17:00",
  classId: 42,
  className: "Hip Hop",
  danceType: "Hip Hop",
};

test("shows only live, general-class upcoming bookings", () => {
  assert.equal(isVisibleUpcomingMyBooking(base, NOW), true);
  assert.equal(isVisibleUpcomingMyBooking({ ...base, bookingStatus: "pending" }, NOW), true);
});

test("cancelled and rejected bookings disappear from My Bookings", () => {
  assert.equal(isVisibleUpcomingMyBooking({ ...base, bookingStatus: "cancelled" }, NOW), false);
  assert.equal(isVisibleUpcomingMyBooking({ ...base, bookingStatus: "rejected" }, NOW), false);
});

test("past, removed, Ballet, and unscheduled bookings stay hidden", () => {
  assert.equal(isVisibleUpcomingMyBooking({ ...base, occurrenceDate: "2026-08-20" }, NOW), false);
  assert.equal(isVisibleUpcomingMyBooking({ ...base, sourceUnavailable: true }, NOW), false);
  assert.equal(isVisibleUpcomingMyBooking({ ...base, bookingType: "ballet" }, NOW), false);
  assert.equal(isVisibleUpcomingMyBooking({ ...base, scheduleStartTime: null }, NOW), false);
});
