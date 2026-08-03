import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCalendarUrlState,
  buildCalendarUrl,
  getTodayString,
} from "./calendarState";

test("calendarState — parseCalendarUrlState returns default state when URL search is empty", () => {
  const state = parseCalendarUrlState("");
  assert.equal(state.view, "week");
  assert.equal(state.date, getTodayString());
  assert.equal(state.branchId, null);
  assert.equal(state.roomId, null);
});

test("calendarState — parseCalendarUrlState correctly parses view, date, branchId, and roomId from URL parameters", () => {
  const state = parseCalendarUrlState("?view=resource&date=2026-08-15&branchId=2&roomId=5");
  assert.equal(state.view, "resource");
  assert.equal(state.date, "2026-08-15");
  assert.equal(state.branchId, 2);
  assert.equal(state.roomId, 5);
});

test("calendarState — parseCalendarUrlState falls back gracefully for invalid parameters", () => {
  const state = parseCalendarUrlState("?view=invalid_mode&date=not-a-date&branchId=abc&roomId=xyz");
  assert.equal(state.view, "week");
  assert.equal(state.date, getTodayString());
  assert.equal(state.branchId, null);
  assert.equal(state.roomId, null);
});

test("calendarState — buildCalendarUrl produces clean URL strings for various state updates", () => {
  const current = parseCalendarUrlState("?view=week&date=2026-08-03");

  // Changing view to resource
  const url1 = buildCalendarUrl({ view: "resource" }, current);
  assert.equal(url1, "/calendar?view=resource&date=2026-08-03");

  // Changing branchId
  const url2 = buildCalendarUrl({ branchId: 2, roomId: null }, current);
  assert.equal(url2, "/calendar?date=2026-08-03&branchId=2");

  // Setting both branchId and roomId
  const url3 = buildCalendarUrl({ branchId: 2, roomId: 5 }, current);
  assert.equal(url3, "/calendar?date=2026-08-03&branchId=2&roomId=5");
});

test("calendarState — buildCalendarUrl omits default week view when view is week", () => {
  const current = parseCalendarUrlState("?view=resource&date=2026-08-03");
  const url = buildCalendarUrl({ view: "week" }, current);
  assert.equal(url, "/calendar?date=2026-08-03");
});
