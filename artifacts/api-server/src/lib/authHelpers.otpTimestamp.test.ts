import assert from "node:assert/strict";
import test from "node:test";

/**
 * Pure unit coverage for `toEpochMs`, the normalizer that fixes the OTP
 * immediate-expiry defect: comparing `email_otps` timestamp strings must go
 * through this function (epoch milliseconds), never JS's raw `<=`/`>=` on
 * the strings themselves — see toEpochMs's doc comment in authHelpers.ts for
 * why the two serialized forms are not lexicographically comparable.
 *
 * This file only proves the normalizer's own contract in isolation, cheaply
 * and without a database. It does NOT prove the real defect is fixed end to
 * end — that requires exercising the actual pg driver → Drizzle
 * `mapFromDriverValue` path, which only a real Postgres round trip can do
 * (see authHelpers.otpExpiry.integration.test.ts).
 *
 * Importing "@workspace/db" (transitively, via authHelpers.ts) requires
 * DATABASE_URL to be set at import time even though no query ever runs in
 * this file — same placeholder pattern as classCapacity.test.ts /
 * backgroundMusic.test.ts / authHelpers.emailProvider.test.ts.
 */
process.env["DATABASE_URL"] ??= "postgres://localhost:1/central_studio_test";

async function loadAuthHelpers() {
  return import("./authHelpers");
}

test("toEpochMs parses a Node-generated ISO string (T separator, Z suffix)", async () => {
  const { toEpochMs } = await loadAuthHelpers();
  const nodeIso = "2026-08-07T12:16:36.570Z";
  assert.equal(toEpochMs(nodeIso), Date.parse(nodeIso));
});

test("toEpochMs parses a Postgres/Drizzle-style string (space separator, numeric offset)", async () => {
  const { toEpochMs } = await loadAuthHelpers();
  const pgFormatted = "2026-08-07 12:16:36.570+00";
  const ms = toEpochMs(pgFormatted);
  assert.ok(Number.isFinite(ms), "must parse successfully, not NaN");
  // Cross-check against the equivalent Node ISO string for the same instant.
  assert.equal(ms, Date.parse("2026-08-07T12:16:36.570Z"));
});

test("toEpochMs produces the SAME epoch value for both serializations of the same instant", async () => {
  const { toEpochMs } = await loadAuthHelpers();
  const nodeIso = "2026-08-07T12:16:36.570Z";
  const pgFormatted = "2026-08-07 12:16:36.570+00";
  assert.equal(toEpochMs(nodeIso), toEpochMs(pgFormatted));
});

test("raw string comparison (the old bug) disagrees with epoch comparison (the fix) for a later pg-format instant", async () => {
  const { toEpochMs } = await loadAuthHelpers();
  // pgLater is genuinely 2 seconds AFTER nodeEarlier — epoch comparison must
  // say pgLater > nodeEarlier. The old buggy raw string comparison instead
  // always says pgLater <= nodeEarlier for same-day values (space sorts
  // before 'T'), which is exactly the defect this fix corrects.
  const nodeEarlier = "2026-08-07T12:16:36.570Z";
  const pgLater = "2026-08-07 12:16:38.570+00"; // +2s
  assert.equal(pgLater <= nodeEarlier, true, "sanity check: this is the bug — the raw string comparison gets it backwards");
  assert.equal(toEpochMs(pgLater) > toEpochMs(nodeEarlier), true, "the fix: epoch comparison gets it right");
});

test("toEpochMs correctly orders a still-valid expiry against 'now', regardless of which format each side is in", async () => {
  const { toEpochMs } = await loadAuthHelpers();
  // Simulates the exact production shape: expiresAt read back in Postgres
  // format, 600s after a createdAt that is itself only 2s in the past.
  const createdAt = new Date("2026-08-07T12:16:36.570Z");
  const expiresAtPgFormatted = new Date(createdAt.getTime() + 600_000)
    .toISOString().slice(0, -1).replace("T", " ") + "+00"; // "2026-08-07 12:26:36.570+00"
  const nowTwoSecondsLater = new Date(createdAt.getTime() + 2_000).toISOString();

  assert.ok(
    toEpochMs(expiresAtPgFormatted) > toEpochMs(nowTwoSecondsLater),
    "a 600s-TTL code checked 2s after issuance must not appear expired",
  );
  // The old, buggy raw-string comparison would have gotten this backwards:
  assert.equal(
    expiresAtPgFormatted <= nowTwoSecondsLater,
    true,
    "sanity check: confirms the raw string comparison really was wrong here (this is the bug, not the fix)",
  );
});

test("toEpochMs returns NaN for an unparseable value (callers must fail closed, not trust it)", async () => {
  const { toEpochMs } = await loadAuthHelpers();
  assert.ok(Number.isNaN(toEpochMs("not-a-timestamp")));
  assert.ok(Number.isNaN(toEpochMs("")));
});
