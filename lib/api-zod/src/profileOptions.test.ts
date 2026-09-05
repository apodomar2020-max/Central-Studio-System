import assert from "node:assert/strict";
import test from "node:test";
import {
  PROFILE_CITIES,
  PROFILE_NATIONALITIES,
  ProfileCitySchema,
  ProfileNationalitySchema,
} from "./profileOptions.ts";

test("profile option lists contain unique analytics values", () => {
  assert.equal(new Set(PROFILE_CITIES).size, PROFILE_CITIES.length);
  assert.equal(new Set(PROFILE_NATIONALITIES).size, PROFILE_NATIONALITIES.length);
});

test("profile option schemas reject arbitrary free text", () => {
  assert.equal(ProfileCitySchema.safeParse("cairooo").success, false);
  assert.equal(ProfileNationalitySchema.safeParse("whatever").success, false);
  assert.equal(ProfileCitySchema.safeParse("Cairo").success, true);
  assert.equal(ProfileNationalitySchema.safeParse("Egyptian").success, true);
});
