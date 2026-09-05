import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profile = readFileSync(new URL("../../app/(tabs)/profile.tsx", import.meta.url), "utf8");
const appContentRoute = readFileSync(new URL("../../../api-server/src/routes/appContent.ts", import.meta.url), "utf8");

test("Profile loads Contact Links from the already-deployed Help & Support response with a rollout fallback", () => {
  assert.match(profile, /customFetch<\{ contacts\?: AppContactLink\[] \}>\("\/api\/content\/help-support"\)/);
  assert.match(profile, /customFetch<AppContactLink\[]>\("\/api\/content\/contact-links"\)/);
  assert.match(appContentRoute, /router\.get\("\/content\/contact-links"/);
  assert.match(appContentRoute, /where\(eq\(appContactLinksTable\.isActive, true\)\)/);
});

test("Contact Us is rendered immediately before Sign Out", () => {
  const contactUsIndex = profile.indexOf(">CONTACT US</Text>");
  const signOutIndex = profile.indexOf(">Sign Out</Text>");

  assert.notEqual(contactUsIndex, -1);
  assert.notEqual(signOutIndex, -1);
  assert.ok(contactUsIndex < signOutIndex);
});

test("social links use icons while phone and email use direct action buttons", () => {
  for (const icon of ["logo-whatsapp", "logo-facebook", "logo-instagram", "logo-tiktok", "logo-youtube"]) {
    assert.match(profile, new RegExp(icon));
  }
  assert.match(profile, /contactLinks\.filter\(isSocialContactLink\)/);
  assert.match(profile, /contactLinks\.filter\(isDirectContactLink\)/);
  assert.match(profile, /Linking\.openURL\(href\)/);
});
