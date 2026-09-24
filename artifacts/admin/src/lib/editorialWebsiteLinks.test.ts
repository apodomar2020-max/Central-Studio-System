/**
 * Final Editorial, Phase A — Website → Settings → Links: the singleton form
 * shape, validation mirrored from the server verbatim, the dirty comparison
 * and the partial PATCH payload.
 *
 * Executed for real. Every validation message is pinned against the SERVER's
 * own `normalizeWebsiteLink` source rather than restated from memory, so an
 * inline hint and a 400 can never drift apart silently.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EMPTY_WEBSITE_LINKS_FORM,
  WEBSITE_LINKS_EMPTY_STATE,
  WEBSITE_LINKS_HTTPS_NOTE,
  WEBSITE_LINKS_PAGE_DESCRIPTION,
  WEBSITE_LINKS_READ_ONLY_NOTICE,
  WEBSITE_LINKS_SAVE_LABEL,
  WEBSITE_LINK_FIELDS,
  WEBSITE_LINK_HINTS,
  WEBSITE_LINK_LABELS,
  areWebsiteLinksDirty,
  hasWebsiteLinksFormErrors,
  isWebsiteLinksEmpty,
  toWebsiteLinksFormValues,
  toWebsiteLinksPayload,
  validateWebsiteLink,
  validateWebsiteLinksForm,
  type WebsiteLinksFormValues,
} from "./editorial-website-links.ts";

const service = readFileSync(
  new URL("../../../api-server/src/lib/editorialWebsiteLinksService.ts", import.meta.url),
  "utf8",
);
const settingsRoute = readFileSync(
  new URL("../../../api-server/src/routes/adminEditorialSettings.ts", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../../../../lib/db/src/schema/editorialWebsiteLinks.ts", import.meta.url),
  "utf8",
);
const generatedZod = readFileSync(
  new URL("../../../../lib/api-zod/src/generated/api.ts", import.meta.url),
  "utf8",
);

function form(overrides: Partial<WebsiteLinksFormValues> = {}): WebsiteLinksFormValues {
  return { ...EMPTY_WEBSITE_LINKS_FORM, ...overrides };
}

const PLAY = "https://play.google.com/store/apps/details?id=com.centralstudio";
const STORE = "https://apps.apple.com/app/id123456789";

// ─── The contract is a SINGLETON, not a list ────────────────────────────────

test("the backend is a one-row, two-column singleton — there is nothing to add or remove", () => {
  // Asserted against source, because the entire UI shape follows from it.
  assert.match(schema, /google_play_url/);
  assert.match(schema, /app_store_url/);
  assert.match(settingsRoute, /router\.get\(\s*"\/admin\/editorial\/settings\/links"/);
  assert.match(settingsRoute, /router\.patch\(\s*"\/admin\/editorial\/settings\/links"/);
  assert.doesNotMatch(settingsRoute, /router\.post\(\s*"\/admin\/editorial\/settings\/links"/);
  assert.doesNotMatch(settingsRoute, /router\.delete\(\s*"\/admin\/editorial\/settings\/links"/);
});

test("the module exposes exactly the two named fields the contract has — no invented link types", () => {
  assert.deepEqual([...WEBSITE_LINK_FIELDS], ["googlePlayUrl", "appStoreUrl"]);
  // The server's own field list, verbatim.
  assert.match(service, /WEBSITE_LINK_FIELDS = \["googlePlayUrl", "appStoreUrl"\] as const/);
  // And the generated body accepts only those two keys.
  assert.match(generatedZod, /UpdateEditorialWebsiteLinksBody = zod[\s\S]{0,400}googlePlayUrl/);
  assert.match(generatedZod, /updateEditorialWebsiteLinksBodyAppStoreUrlMax = 2000/);
});

test("the field labels are the SERVER's labels, so an inline error and a 400 name the same thing", () => {
  assert.equal(WEBSITE_LINK_LABELS.googlePlayUrl, "Google Play link");
  assert.equal(WEBSITE_LINK_LABELS.appStoreUrl, "App Store link");
  assert.match(service, /googlePlayUrl: "Google Play link"/);
  assert.match(service, /appStoreUrl: "App Store link"/);
});

// ─── Load / initial shape ───────────────────────────────────────────────────

test("toWebsiteLinksFormValues turns NULLs into empty strings, never into placeholders", () => {
  assert.deepEqual(toWebsiteLinksFormValues(null), { googlePlayUrl: "", appStoreUrl: "" });
  assert.deepEqual(toWebsiteLinksFormValues(undefined), { googlePlayUrl: "", appStoreUrl: "" });
  assert.deepEqual(
    toWebsiteLinksFormValues({ googlePlayUrl: null, appStoreUrl: null }),
    { googlePlayUrl: "", appStoreUrl: "" },
  );
  assert.deepEqual(
    toWebsiteLinksFormValues({ googlePlayUrl: PLAY, appStoreUrl: null }),
    { googlePlayUrl: PLAY, appStoreUrl: "" },
  );
  assert.deepEqual(
    toWebsiteLinksFormValues({ googlePlayUrl: PLAY, appStoreUrl: STORE }),
    { googlePlayUrl: PLAY, appStoreUrl: STORE },
  );
});

test("isWebsiteLinksEmpty recognises the genuinely-unconfigured state", () => {
  assert.equal(isWebsiteLinksEmpty(form()), true);
  assert.equal(isWebsiteLinksEmpty(form({ googlePlayUrl: "   " })), true, "whitespace is not configuration");
  assert.equal(isWebsiteLinksEmpty(form({ googlePlayUrl: PLAY })), false);
});

// ─── Validation, mirrored verbatim ──────────────────────────────────────────

test("BLANK IS VALID — the columns are nullable and an unset badge is a supported state", () => {
  assert.equal(validateWebsiteLink("googlePlayUrl", ""), null);
  assert.equal(validateWebsiteLink("appStoreUrl", "   "), null);
  assert.deepEqual(validateWebsiteLinksForm(form()), {});
  assert.equal(hasWebsiteLinksFormErrors({}), false);
  assert.match(WEBSITE_LINKS_EMPTY_STATE, /Neither download link is configured/);
});

test("a valid absolute https URL passes, and is accepted with surrounding whitespace", () => {
  assert.equal(validateWebsiteLink("googlePlayUrl", PLAY), null);
  assert.equal(validateWebsiteLink("appStoreUrl", `  ${STORE}  `), null);
});

test("forbidden characters are rejected FIRST, with the server's exact message", () => {
  const message = validateWebsiteLink("googlePlayUrl", 'https://play.google.com/<script>');
  assert.equal(
    message,
    "The Google Play link contains characters that are not allowed in a URL (spaces, quotes, angle brackets, or backslashes).",
  );
  assert.match(service, /contains characters that are not allowed in a URL \(spaces, quotes, angle brackets, or backslashes\)\./);
  // The whole forbidden set, one character at a time.
  for (const bad of ["<", ">", '"', "'", "\\", " "]) {
    assert.ok(
      validateWebsiteLink("appStoreUrl", `https://apps.apple.com/a${bad}b`)?.includes("not allowed in a URL"),
      `${JSON.stringify(bad)} must be refused`,
    );
  }
});

test("an unparseable value, a non-https protocol and a hostless URL each get the server's message", () => {
  assert.equal(validateWebsiteLink("appStoreUrl", "not-a-url"), "The App Store link is not a valid URL.");
  assert.equal(validateWebsiteLink("appStoreUrl", "http://apps.apple.com/x"), "The App Store link must use https.");
  assert.equal(validateWebsiteLink("googlePlayUrl", "ftp://example.com/x"), "The Google Play link must use https.");
  // The "must include a host" branch exists in BOTH validators and is
  // effectively unreachable for an https URL, because WHATWG `new URL`
  // collapses `https:///path` into the host `path`. Asserted as the REAL
  // shared behaviour rather than as an invented client-only rule: the point
  // of this module is that the two agree, including where they agree on
  // being lenient.
  assert.equal(validateWebsiteLink("appStoreUrl", "https:///apps.apple.com"), null);
  assert.equal(new URL("https:///apps.apple.com").hostname, "apps.apple.com");
  assert.match(service, /is not a valid URL\./);
  assert.match(service, /must use https\./);
  assert.match(service, /must include a host\./);
});

test("nothing is relaxed for UX convenience — a protocol-relative or bare host is still refused", () => {
  assert.equal(validateWebsiteLink("googlePlayUrl", "//play.google.com/x"), "The Google Play link is not a valid URL.");
  assert.equal(validateWebsiteLink("googlePlayUrl", "play.google.com"), "The Google Play link is not a valid URL.");
});

test("validateWebsiteLinksForm reports each field independently", () => {
  const errors = validateWebsiteLinksForm(form({ googlePlayUrl: "http://x.test/a", appStoreUrl: STORE }));
  assert.deepEqual(Object.keys(errors), ["googlePlayUrl"]);
  assert.equal(hasWebsiteLinksFormErrors(errors), true);

  const both = validateWebsiteLinksForm(form({ googlePlayUrl: "nope", appStoreUrl: "also nope" }));
  assert.deepEqual(Object.keys(both).sort(), ["appStoreUrl", "googlePlayUrl"]);
});

// ─── Dirty ──────────────────────────────────────────────────────────────────

test("the dirty comparison is on the NORMALIZED value, so whitespace alone is not a change", () => {
  const baseline = form({ googlePlayUrl: PLAY });
  assert.equal(areWebsiteLinksDirty(baseline, baseline), false);
  assert.equal(areWebsiteLinksDirty(form({ googlePlayUrl: `  ${PLAY}  ` }), baseline), false);
  assert.equal(areWebsiteLinksDirty(form({ googlePlayUrl: STORE }), baseline), true);
  // "" and "   " both normalize to null, so neither is a change from unset.
  assert.equal(areWebsiteLinksDirty(form({ googlePlayUrl: "   " }), form()), false);
  // Clearing a configured link IS a change.
  assert.equal(areWebsiteLinksDirty(form(), baseline), true);
});

// ─── Payload: partial, only what changed ────────────────────────────────────

test("ONLY CHANGED FIELDS are sent — an untouched link never reaches the audit row", () => {
  const baseline = form({ googlePlayUrl: PLAY, appStoreUrl: STORE });
  const payload = toWebsiteLinksPayload(form({ googlePlayUrl: PLAY, appStoreUrl: "https://apps.apple.com/app/id999" }), baseline);
  assert.deepEqual(payload, { appStoreUrl: "https://apps.apple.com/app/id999" });
  assert.equal("googlePlayUrl" in payload, false, "an absent key means leave it alone");
});

test("an unchanged form produces an EMPTY payload", () => {
  const baseline = form({ googlePlayUrl: PLAY, appStoreUrl: STORE });
  assert.deepEqual(toWebsiteLinksPayload(baseline, baseline), {});
  assert.deepEqual(toWebsiteLinksPayload(form({ googlePlayUrl: ` ${PLAY} `, appStoreUrl: STORE }), baseline), {});
});

test("clearing a link sends an EXPLICIT null, which is how the route clears a column", () => {
  const baseline = form({ googlePlayUrl: PLAY, appStoreUrl: STORE });
  const payload = toWebsiteLinksPayload(form({ appStoreUrl: STORE }), baseline);
  assert.deepEqual(payload, { googlePlayUrl: null });
  assert.equal(payload.googlePlayUrl, null, "null, not undefined and not an empty string");
  // The contract genuinely accepts null for both fields.
  assert.match(generatedZod, /googlePlayUrl: zod[\s\S]{0,120}\.nullish\(\)/);
});

test("the value sent is TRIMMED, matching what the server would store", () => {
  const payload = toWebsiteLinksPayload(form({ googlePlayUrl: `  ${PLAY}  ` }), form());
  assert.deepEqual(payload, { googlePlayUrl: PLAY });
});

test("both fields can change in ONE payload — a save is one PATCH, never two", () => {
  const payload = toWebsiteLinksPayload(form({ googlePlayUrl: PLAY, appStoreUrl: STORE }), form());
  assert.deepEqual(payload, { googlePlayUrl: PLAY, appStoreUrl: STORE });
});

// ─── Copy ───────────────────────────────────────────────────────────────────

test("the copy is honest about blank being supported and about https being mandatory", () => {
  assert.match(WEBSITE_LINKS_PAGE_DESCRIPTION, /Leave one blank to hide that badge/);
  assert.match(WEBSITE_LINKS_HTTPS_NOTE, /must start with https:\/\//);
  assert.match(WEBSITE_LINKS_READ_ONLY_NOTICE, /cannot change them/);
  assert.equal(WEBSITE_LINKS_SAVE_LABEL, "Save links");
  assert.equal(WEBSITE_LINK_HINTS.googlePlayUrl, "The Android download badge on the public website.");
  assert.equal(WEBSITE_LINK_HINTS.appStoreUrl, "The iOS download badge on the public website.");
});
