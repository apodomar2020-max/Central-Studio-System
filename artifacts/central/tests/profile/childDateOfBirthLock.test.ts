import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profile = readFileSync(new URL("../../app/(tabs)/profile.tsx", import.meta.url), "utf8");
const context = readFileSync(new URL("../../contexts/AppContext.tsx", import.meta.url), "utf8");

test("child date of birth is visibly disabled when the server marks it locked", () => {
  assert.match(profile, /const dateOfBirthLocked = initial\?\.dateOfBirthLocked === true/);
  assert.match(profile, /disabled=\{dateOfBirthLocked\}/);
  assert.match(profile, /accessibilityState=\{\{ disabled: dateOfBirthLocked \}\}/);
  assert.match(profile, /Locked because this child already has class, package, or Ballet activity\./);
});

test("child lock metadata survives API-to-app mapping", () => {
  assert.match(context, /dateOfBirthLocked\?: boolean/);
  assert.match(context, /dateOfBirthLockReasons\?: Array<"class_booking" \| "package_subscription" \| "ballet_application">/);
  assert.ok((context.match(/dateOfBirthLocked: c\.dateOfBirthLocked === true/g) ?? []).length >= 3);
});

test("a successful booking refresh removes local rows absent from the server", () => {
  const refreshStart = context.indexOf("async function fetchAndSetBookings");
  const refreshEnd = context.indexOf("async function fetchAndSetChildren", refreshStart);
  const refresh = context.slice(refreshStart, refreshEnd);
  assert.match(refresh, /setBookings\(serverBookings\)/);
  assert.doesNotMatch(refresh, /localOnly|merged/);
});
