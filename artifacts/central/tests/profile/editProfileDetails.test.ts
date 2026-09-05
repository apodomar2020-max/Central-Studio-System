import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profile = readFileSync(new URL("../../app/(tabs)/profile.tsx", import.meta.url), "utf8");
const editProfile = readFileSync(new URL("../../app/edit-profile.tsx", import.meta.url), "utf8");
const completeProfile = readFileSync(new URL("../../app/auth/complete-profile.tsx", import.meta.url), "utf8");
const dateField = readFileSync(new URL("../../components/ProfileDateField.tsx", import.meta.url), "utf8");

test("the public profile header no longer exposes email, phone, or connected provider", () => {
  const headerStart = profile.indexOf("<View style={styles.profileCard}>");
  const headerEnd = profile.indexOf("<View style={styles.statsRow}>", headerStart);
  const header = profile.slice(headerStart, headerEnd);

  assert.doesNotMatch(header, /user\.email(?!Verified)|user\.phone|accountTypeProvider|authProvider/);
  assert.match(header, /styles\.accountTypeRole/);
});

test("Edit Profile exposes safe personal details but not analytics acquisition fields", () => {
  for (const label of ["Gender", "Date of Birth", "City", "Nationality"]) {
    assert.ok(editProfile.includes(`>${label}</Text>`), `missing ${label}`);
  }
  assert.doesNotMatch(editProfile, /How Did You Hear About Us|Dance Interests|danceTypeIds|danceInterestIds/);
  assert.doesNotMatch(editProfile, /howDidYouHearAboutUs/);
});

test("account type controls consume the backend lock and cannot be pressed while locked", () => {
  assert.match(editProfile, /customFetch<AccountTypeChangePolicy>\("\/api\/auth\/account-type-change-policy"\)/);
  assert.match(editProfile, /disabled=\{accountTypePolicyLoading \|\| accountTypePolicy\?\.locked === true\}/);
  assert.match(editProfile, /ACCOUNT_TYPE_CHANGE_LOCKED/);
});

test("city and nationality are shared dropdowns in registration and editing", () => {
  for (const source of [completeProfile, editProfile]) {
    assert.match(source, /<ProfileSelectField/);
    assert.match(source, /options=\{PROFILE_CITIES\}/);
    assert.match(source, /options=\{PROFILE_NATIONALITIES\}/);
  }
});

test("Edit Profile date of birth is selected from a calendar instead of typed", () => {
  assert.match(editProfile, /<ProfileDateField/);
  assert.doesNotMatch(editProfile, /onChangeText=\{handleDateOfBirthChange\}/);
  assert.match(dateField, /WEEK_DAYS/);
  assert.match(dateField, /calendarDays\.map/);
});

test("immutable account fields have an explicit locked visual treatment", () => {
  assert.match(editProfile, /name="lock-closed"/);
  assert.match(editProfile, />READ ONLY<\/Text>/);
  assert.match(editProfile, /readOnlyTextWrap:[\s\S]*backgroundColor: "#111418"/);
});

test("Edit Profile shows the saved profile photo and falls back to initials", () => {
  assert.match(editProfile, /user\.avatarUrl \? \(/);
  assert.match(editProfile, /source=\{\{ uri: user\.avatarUrl \}\}/);
  assert.match(editProfile, /style=\{styles\.avatarImage\}/);
  assert.match(editProfile, /styles\.avatarInitials/);
});
