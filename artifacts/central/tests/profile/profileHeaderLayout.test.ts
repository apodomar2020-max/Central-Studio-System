import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profile = readFileSync(new URL("../../app/(tabs)/profile.tsx", import.meta.url), "utf8");

const headerStart = profile.indexOf("<View style={styles.profileCard}>");
const accountStart = profile.indexOf('<Text style={styles.sectionEyebrow}>ACCOUNT</Text>', headerStart);
const header = profile.slice(headerStart, accountStart);

test("the compact Member Pass sits in the profile header and preserves QR navigation", () => {
  assert.match(header, /testID="profile-member-pass"/);
  assert.match(header, /PROFILE_MEMBER_PASS_ICON/);
  assert.match(header, /pushOnce\("\/my-qr"\)/);
  assert.doesNotMatch(header, /MY STUDIO PASS|styles\.qrCard|<QRCode/);
});

test("identity, account type, date of birth, and location share the new header", () => {
  assert.match(header, /styles\.identityRow/);
  assert.match(header, /numberOfLines=\{1\} ellipsizeMode="tail" style=\{styles\.fullName\}/);
  assert.match(header, /styles\.accountTypePill/);
  assert.match(header, /PROFILE_CALENDAR_ICON/);
  assert.match(header, /dateOfBirthLabel/);
  assert.match(header, /PROFILE_LOCATION_ICON/);
  assert.match(header, /locationLabel/);
});

test("profile statistics remain below the header without card or icon boxes", () => {
  assert.match(header, /styles\.statsRow/);
  assert.match(profile, /statCard: \{ flex: 1, paddingVertical: 6, paddingHorizontal: 8, alignItems: "center" \}/);
  assert.match(profile, /statIconWrap: \{ height: 24, alignItems: "center", justifyContent: "center", marginBottom: 5 \}/);
  assert.equal((header.match(/styles\.statCardDivider/g) ?? []).length, 2);
  assert.match(profile, /borderRightWidth: StyleSheet\.hairlineWidth/);
});
