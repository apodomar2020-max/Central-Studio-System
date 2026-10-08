import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./bookings.tsx", import.meta.url), "utf8");

test("Admin Bookings has no creation control, mutation, or create-mode dialog", () => {
  assert.doesNotMatch(page, /useCreateBooking|createBooking|openCreate|button-add-booking|Add Booking|New Booking|Create Booking/);
  assert.match(page, /<DialogTitle>Edit Booking<\/DialogTitle>/);
});

test("booking edits require an existing record and edit permission", () => {
  assert.match(page, /if \(!editing \|\| !canEdit\) return;/);
  assert.match(page, /updateBooking\.mutate\(\{ id: editing\.id, data: parsed \}/);
  assert.match(page, /disabled=\{!editing \|\| !canEdit \|\| updateBooking\.isPending\}/);
});
