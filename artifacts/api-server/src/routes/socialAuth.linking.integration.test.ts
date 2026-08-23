/**
 * Security-01B1 — CS-SEC-C-01 provider-linking regression suite.
 *
 * Proves the containment invariants for /api/auth/{google,facebook,apple}:
 * a provider identity may only attach itself to a PRE-EXISTING account when
 * the provider genuinely attests the address, and every refusal leaves the
 * target row byte-for-byte unchanged.
 *
 * Harness mirrors bookings.notificationPostCommit.integration.test.ts:
 * in-process express app + real disposable Postgres, with
 * `../lib/socialProviders` replaced via node:test mock.module so the three
 * provider verifiers can be driven directly (no live Google/Facebook calls,
 * no real provider tokens). Requires --experimental-test-module-mocks.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, test, mock } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_SOCIAL_AUTH_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_social_auth";

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Refusing: DATABASE_URL host "${url.hostname}" is not localhost/127.0.0.1`);
  }
  if (!/disposable|local|test/i.test(url.pathname)) {
    throw new Error(`Refusing: database name "${url.pathname}" does not look disposable/local/test`);
  }
  if (/rlwy\.net|railway/i.test(databaseUrl)) {
    throw new Error("Refusing: DATABASE_URL looks like Railway");
  }
}
assertDisposableUrl(DATABASE_URL);

process.env.DATABASE_URL = DATABASE_URL;
process.env.API_SECRET_KEY = "test-api-secret-key";
process.env.STUDENT_JWT_SECRET = "test-student-secret";
process.env.ADMIN_JWT_SECRET = "test-admin-secret";
delete process.env.REDIS_URL;
delete process.env.BREVO_API_KEY; // OTP send is a dev-mode no-op
process.env.IDENTITY_PROVENANCE_PEPPER = "test-regression-identity-provenance-pepper".padEnd(64, "0");

type EmailTrust = "provider_attested" | "provider_asserted" | "none";
type Identity = {
  provider: "google" | "apple" | "facebook";
  providerId: string;
  email: string | null;
  emailTrust: EmailTrust;
  name: string | null;
  avatarUrl: string | null;
};

/** Set by each test; consumed by the mocked verifyProviderToken. */
let nextIdentity: Identity | null = null;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;

function apiUrl(path: string): string { return `http://127.0.0.1:${port}${path}`; }

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.API_SECRET_KEY}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

type Row = {
  id: number; email: string; email_verified: boolean; email_verified_at: string | null;
  auth_provider: string | null; google_id: string | null; facebook_id: string | null;
  apple_id: string | null; provider_display_name: string | null;
  avatar_url: string | null; avatar_source: string | null; name: string;
};

async function readRow(id: number): Promise<Row> {
  const r = await pool.query(
    `SELECT id, email, email_verified, email_verified_at, auth_provider, google_id, facebook_id,
            apple_id, provider_display_name, avatar_url, avatar_source, name
       FROM students WHERE id = $1`, [id]);
  return r.rows[0] as Row;
}

/** Fields a rejected attempt must never touch. */
function identityFields(r: Row) {
  return {
    email_verified: r.email_verified, email_verified_at: r.email_verified_at,
    auth_provider: r.auth_provider, google_id: r.google_id, facebook_id: r.facebook_id,
    apple_id: r.apple_id, provider_display_name: r.provider_display_name,
    avatar_url: r.avatar_url, avatar_source: r.avatar_source,
  };
}

let seq = 0;
async function makeVictim(opts: {
  emailVerified?: boolean; googleId?: string | null; facebookId?: string | null;
} = {}): Promise<Row> {
  seq += 1;
  const email = `victim-${Date.now()}-${seq}@example.com`;
  const verified = opts.emailVerified ?? true;
  const r = await pool.query(
    `INSERT INTO students (name, email, email_verified, email_verified_at, auth_provider,
                           google_id, facebook_id, provider_display_name, avatar_url, avatar_source,
                           password_hash)
     VALUES ('Victim Owner', $1, $2, $3, 'local', $4, $5, 'Victim Owner', 'https://cdn.example.com/victim.png', 'manual', 'x')
     RETURNING id`,
    [email, verified, verified ? new Date().toISOString() : null, opts.googleId ?? null, opts.facebookId ?? null],
  );
  return readRow(r.rows[0].id as number);
}

function decodeJwt(token: string): any {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

// The route discriminates failures with `instanceof`, so the mock must export
// the SAME class objects it throws — declaring them here (not inline in
// namedExports) is what makes `err instanceof ProviderNotConfiguredError`
// hold inside socialAuth.ts, exactly as it does against the real module.
class MockProviderNotConfiguredError extends Error {
  requiredEnv: string[];
  constructor(provider: string, requiredEnv: string[]) {
    super(`${provider} sign-in is not configured on the server.`);
    this.name = "ProviderNotConfiguredError";
    this.requiredEnv = requiredEnv;
  }
}
class MockProviderTokenInvalidError extends Error {
  constructor(message = "Invalid or expired provider token.") {
    super(message);
    this.name = "ProviderTokenInvalidError";
  }
}

before(async () => {
  mock.module("../lib/socialProviders", {
    namedExports: {
      ProviderNotConfiguredError: MockProviderNotConfiguredError,
      ProviderTokenInvalidError: MockProviderTokenInvalidError,
      verifyProviderToken: async (provider: string) => {
        if (provider === "apple") {
          // Byte-for-byte the real module's behavior: verifyApple() is an
          // unconditional throw of this exact error type, before any account
          // lookup can occur. See lib/socialProviders.ts verifyApple().
          throw new MockProviderNotConfiguredError("apple", ["APPLE_CLIENT_ID"]);
        }
        if (!nextIdentity) throw new Error("test did not set nextIdentity");
        return nextIdentity;
      },
    },
  });

  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  const expressModule = await import("express");
  const express = expressModule.default;
  const { requireAuth } = await import("../middlewares/auth");
  const { requireVerifiedStudent } = await import("../middlewares/studentAuth");
  const socialRouter = (await import("./socialAuth")).default;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", socialRouter);
  // Test-only probe mounted behind the SAME requireVerifiedStudent guard every
  // real verified-only route uses, so "does this token satisfy it" is proven
  // against the actual middleware rather than by decoding the JWT ourselves.
  app.get("/api/__test/verified-only", requireVerifiedStudent, (_req, res) => {
    res.json({ ok: true });
  });
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as import("node:net").AddressInfo).port;
});

beforeEach(() => { nextIdentity = null; });

after(async () => {
  mock.reset();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Already-linked provider id signs in, without any email lookup
// ─────────────────────────────────────────────────────────────────────────────
test("already-linked google id signs in normally and never consults the email path", async () => {
  const sub = `google-sub-${Date.now()}-linked`;
  const victim = await makeVictim({ emailVerified: true, googleId: sub });

  // Identity carries an email belonging to NOBODY and no attestation. If the
  // resolver were consulting the email path, this could not produce a login.
  nextIdentity = {
    provider: "google", providerId: sub,
    email: `unrelated-${Date.now()}@example.com`, emailTrust: "none",
    name: "Victim Owner", avatarUrl: null,
  };

  const { status, json } = await post("/api/auth/google", { idToken: "t" });
  assert.equal(status, 200);
  assert.equal(json.student.id, victim.id);
  assert.equal(json.requiresOtp, false);
  assert.equal(decodeJwt(json.accessToken).sub, victim.id);

  const after = await readRow(victim.id);
  assert.equal(after.google_id, sub, "link is preserved");
  assert.equal(after.email, victim.email, "account email is never rewritten");
});

test("already-linked facebook id signs in normally (unaffected by the new tier rules)", async () => {
  const sub = `fb-sub-${Date.now()}-linked`;
  const victim = await makeVictim({ emailVerified: true, facebookId: sub });
  nextIdentity = {
    provider: "facebook", providerId: sub, email: victim.email,
    emailTrust: "provider_asserted", name: "Victim Owner", avatarUrl: null,
  };
  const { status, json } = await post("/api/auth/facebook", { accessToken: "t" });
  assert.equal(status, 200);
  assert.equal(json.student.id, victim.id);
  assert.equal(json.requiresOtp, false);
  assert.equal((await readRow(victim.id)).facebook_id, sub);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Google attested + existing account -> safe link + full token
// ─────────────────────────────────────────────────────────────────────────────
test("google attested email + existing matching account -> links and issues a full token", async () => {
  const victim = await makeVictim({ emailVerified: true });
  const sub = `google-sub-${Date.now()}-attested`;
  nextIdentity = {
    provider: "google", providerId: sub, email: victim.email,
    emailTrust: "provider_attested", name: "Real Owner", avatarUrl: "https://cdn.example.com/g.png",
  };

  const { status, json } = await post("/api/auth/google", { idToken: "t" });
  assert.equal(status, 200);
  assert.equal(json.student.id, victim.id);
  assert.equal(json.requiresOtp, false);
  assert.equal(decodeJwt(json.accessToken).emailVerified, true);

  const after = await readRow(victim.id);
  assert.equal(after.google_id, sub, "attested link is written");
  assert.equal(after.auth_provider, "google");
  // avatar_source was 'manual' — a manual avatar must never be overwritten.
  assert.equal(after.avatar_url, victim.avatar_url);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. V3 — Google UNATTESTED email + existing account -> refused, nothing written
// ─────────────────────────────────────────────────────────────────────────────
test("V3: google unverified email + existing matching account -> no link, no token", async () => {
  const victim = await makeVictim({ emailVerified: true });
  const before = identityFields(victim);
  nextIdentity = {
    provider: "google", providerId: `google-sub-${Date.now()}-unattested`,
    email: victim.email, emailTrust: "provider_asserted",
    name: "Attacker Name", avatarUrl: "https://cdn.example.com/attacker.png",
  };

  const { status, json } = await post("/api/auth/google", { idToken: "t" });
  assert.equal(status, 409);
  assert.equal(json.code, "PROVIDER_LINK_VERIFICATION_REQUIRED");
  assert.equal(json.requiresLinkVerification, true);
  assert.equal(json.accessToken, undefined, "no token of any kind");
  assert.equal(json.student, undefined, "no profile disclosure");

  assert.deepEqual(identityFields(await readRow(victim.id)), before, "row untouched");
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. V2 — Google no email + body email attempt -> body email ignored
// ─────────────────────────────────────────────────────────────────────────────
test("V2: google with no email claim + body email -> body email ignored, no link", async () => {
  const victim = await makeVictim({ emailVerified: true });
  const before = identityFields(victim);
  nextIdentity = {
    provider: "google", providerId: `google-sub-${Date.now()}-noemail`,
    email: null, emailTrust: "none", name: "Attacker Name", avatarUrl: null,
  };

  const { status, json } = await post("/api/auth/google", { idToken: "t", email: victim.email });
  assert.equal(status, 200);
  assert.equal(json.requiresEmail, true, "falls through to the non-linking response");
  assert.equal(json.accessToken, undefined);
  assert.equal(json.student, undefined);

  assert.deepEqual(identityFields(await readRow(victim.id)), before, "row untouched");
  const stray = await pool.query(`SELECT id FROM students WHERE google_id = $1`, [nextIdentity.providerId]);
  assert.equal(stray.rowCount, 0, "no account anywhere received this provider id");
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. V1 — Facebook email + existing account -> refused
// ─────────────────────────────────────────────────────────────────────────────
test("facebook asserted email + existing matching account -> no link, no token", async () => {
  const victim = await makeVictim({ emailVerified: true });
  const before = identityFields(victim);
  nextIdentity = {
    provider: "facebook", providerId: `fb-sub-${Date.now()}-assert`,
    email: victim.email, emailTrust: "provider_asserted",
    name: "Attacker Name", avatarUrl: "https://cdn.example.com/attacker.png",
  };

  const { status, json } = await post("/api/auth/facebook", { accessToken: "t" });
  assert.equal(status, 409);
  assert.equal(json.code, "PROVIDER_LINK_VERIFICATION_REQUIRED");
  assert.equal(json.requiresLinkVerification, true);
  assert.equal(json.provider, "facebook");
  assert.match(json.maskedEmail, /^.\*+@/, "email is masked in the response");
  assert.equal(json.accessToken, undefined);

  assert.deepEqual(identityFields(await readRow(victim.id)), before, "row untouched");
});

test("V1: facebook with no email + body email -> body email ignored, no link", async () => {
  const victim = await makeVictim({ emailVerified: true });
  const before = identityFields(victim);
  nextIdentity = {
    provider: "facebook", providerId: `fb-sub-${Date.now()}-noemail`,
    email: null, emailTrust: "none", name: "Attacker Name", avatarUrl: null,
  };

  const { status, json } = await post("/api/auth/facebook", { accessToken: "t", email: victim.email });
  assert.equal(status, 200);
  assert.equal(json.requiresEmail, true);
  assert.equal(json.accessToken, undefined);

  assert.deepEqual(identityFields(await readRow(victim.id)), before, "row untouched");
  const stray = await pool.query(`SELECT id FROM students WHERE facebook_id = $1`, [nextIdentity.providerId]);
  assert.equal(stray.rowCount, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Provider-id overwrite protection
// ─────────────────────────────────────────────────────────────────────────────
test("an existing DIFFERENT google_id is never overwritten (attested attacker)", async () => {
  const legitSub = `google-sub-${Date.now()}-legit`;
  const victim = await makeVictim({ emailVerified: true, googleId: legitSub });
  const before = identityFields(victim);
  nextIdentity = {
    provider: "google", providerId: `google-sub-${Date.now()}-other`,
    email: victim.email, emailTrust: "provider_attested", name: "Other", avatarUrl: null,
  };

  const { status, json } = await post("/api/auth/google", { idToken: "t" });
  assert.equal(status, 409);
  assert.equal(json.code, "PROVIDER_ALREADY_LINKED");
  assert.equal(json.accessToken, undefined);

  const after = await readRow(victim.id);
  assert.equal(after.google_id, legitSub, "legitimate link survives");
  assert.deepEqual(identityFields(after), before);
});

test("an existing DIFFERENT facebook_id is never overwritten", async () => {
  const legitSub = `fb-sub-${Date.now()}-legit`;
  const victim = await makeVictim({ emailVerified: true, facebookId: legitSub });
  const before = identityFields(victim);
  nextIdentity = {
    provider: "facebook", providerId: `fb-sub-${Date.now()}-other`,
    email: victim.email, emailTrust: "provider_asserted", name: "Other", avatarUrl: null,
  };

  const { status, json } = await post("/api/auth/facebook", { accessToken: "t" });
  assert.equal(status, 409);
  // Facebook is never attested, so it is stopped one gate earlier — either
  // refusal is acceptable, both leave the row untouched.
  assert.ok(["PROVIDER_LINK_VERIFICATION_REQUIRED", "PROVIDER_ALREADY_LINKED"].includes(json.code));
  const after = await readRow(victim.id);
  assert.equal(after.facebook_id, legitSub, "legitimate link survives");
  assert.deepEqual(identityFields(after), before);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. New-account creation semantics
// ─────────────────────────────────────────────────────────────────────────────
test("google attested email + no existing account -> new VERIFIED account", async () => {
  const email = `fresh-g-${Date.now()}@example.com`;
  nextIdentity = {
    provider: "google", providerId: `google-sub-${Date.now()}-new`,
    email, emailTrust: "provider_attested", name: "Fresh User", avatarUrl: null,
  };
  const { status, json } = await post("/api/auth/google", { idToken: "t" });
  assert.equal(status, 200);
  assert.equal(json.requiresOtp, false);
  const row = await readRow(json.student.id);
  assert.equal(row.email_verified, true);
  assert.equal(row.google_id, nextIdentity.providerId);

  // B3B0-1A verification closure item 13 — route-specific wiring proof (not
  // just the shared helper tested in isolation): the real /api/auth/google
  // route opened an initial provenance interval for this specific student.
  const provenance = (await pool.query(
    `SELECT valid_from, valid_to FROM student_email_identity_history WHERE student_id = $1`,
    [json.student.id],
  )).rows;
  assert.equal(provenance.length, 1, "exactly one provenance interval opened for the new google student");
  assert.equal(provenance[0].valid_to, null, "interval is open");
  assert.ok(
    Math.abs(new Date(provenance[0].valid_from).getTime() - Date.now()) < 60_000,
    "validFrom is close to now (server time, not backdated)",
  );
});

test("facebook asserted email + no existing account -> new UNVERIFIED account (OTP path)", async () => {
  const email = `fresh-f-${Date.now()}@example.com`;
  nextIdentity = {
    provider: "facebook", providerId: `fb-sub-${Date.now()}-new`,
    email, emailTrust: "provider_asserted", name: "Fresh FB", avatarUrl: null,
  };
  const { status, json } = await post("/api/auth/facebook", { accessToken: "t" });
  assert.equal(status, 200);
  assert.equal(json.requiresOtp, true, "asserted-only email must not be treated as verified");
  assert.equal(decodeJwt(json.accessToken).emailVerified, false, "limited token only");
  const row = await readRow(json.student.id);
  assert.equal(row.email_verified, false);
  assert.equal(row.email_verified_at, null);

  // B3B0-1A verification closure item 14 — route-specific wiring proof for
  // Facebook specifically (previously only indirect, via the Branch-3 path
  // shared with google): the real /api/auth/facebook route opened an
  // initial provenance interval for this student, and it was NOT skipped
  // or deferred merely because the provider email is only "asserted" (not
  // yet verified) — provenance tracks account-email ownership, which is
  // independent of the emailVerified/OTP trust state.
  const provenance = (await pool.query(
    `SELECT valid_from, valid_to FROM student_email_identity_history WHERE student_id = $1`,
    [row.id],
  )).rows;
  assert.equal(provenance.length, 1, "exactly one provenance interval opened for the new facebook student");
  assert.equal(provenance[0].valid_to, null, "interval is open");
  assert.ok(
    Math.abs(new Date(provenance[0].valid_from).getTime() - Date.now()) < 60_000,
    "validFrom is close to now (server time, not backdated)",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Apple stays fail-closed
// ─────────────────────────────────────────────────────────────────────────────
test("apple still returns 501 and performs no linking", async () => {
  const victim = await makeVictim({ emailVerified: true });
  const before = identityFields(victim);
  const { status, json } = await post("/api/auth/apple", { token: "t", email: victim.email });
  assert.equal(status, 501);
  assert.equal(json.accessToken, undefined);
  assert.equal(json.requiredEnv, undefined, "config details are never disclosed to clients");
  assert.deepEqual(identityFields(await readRow(victim.id)), before);
  const stray = await pool.query(`SELECT id FROM students WHERE apple_id IS NOT NULL`);
  assert.equal(stray.rowCount, 0, "no apple_id is ever written");
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Facebook new-account creation — full assertion set (Security-01B1 review)
//
// A more complete companion to "facebook asserted email + no existing account"
// above: this one additionally proves exactly-one-row, the OTP row itself,
// and — via a real requireVerifiedStudent-gated route, not JWT introspection —
// that the limited token genuinely cannot reach a verified-only endpoint.
// ─────────────────────────────────────────────────────────────────────────────
test("facebook new provider id + asserted email + no existing account -> unverified account, limited token, OTP row, blocked from verified-only routes", async () => {
  const email = `fresh-fb-full-${Date.now()}@example.com`;
  const providerId = `fb-sub-${Date.now()}-full`;
  nextIdentity = {
    provider: "facebook", providerId, email,
    emailTrust: "provider_asserted", name: "Fresh Facebook User", avatarUrl: null,
  };

  const beforeCount = (await pool.query(`SELECT count(*)::int AS n FROM students WHERE email = $1`, [email])).rows[0].n;
  assert.equal(beforeCount, 0, "precondition: no account exists for this email yet");

  const { status, json } = await post("/api/auth/facebook", { accessToken: "t" });
  assert.equal(status, 200);

  // Exactly one new student was created, and facebook_id is linked to it.
  const rows = (await pool.query(`SELECT id, facebook_id, email_verified, email_verified_at, auth_provider
                                     FROM students WHERE email = $1`, [email])).rows;
  assert.equal(rows.length, 1, "exactly one new student row");
  const row = rows[0];
  assert.equal(row.facebook_id, providerId, "facebook_id linked to the newly created account");
  assert.equal(row.email_verified, false, "provider_asserted alone never marks verified");
  assert.equal(row.email_verified_at, null);
  assert.equal(row.auth_provider, "facebook");

  // Limited token: response and claim shape.
  assert.equal(json.requiresOtp, true);
  assert.equal(json.student.id, row.id);
  const claims = decodeJwt(json.accessToken);
  assert.equal(claims.sub, row.id);
  assert.equal(claims.type, "student");
  assert.equal(claims.emailVerified, false, "token carries the limited (unverified) claim");

  // An OTP row with purpose "verify" was created for this account/email.
  const otpRows = (await pool.query(
    `SELECT student_id, purpose, used_at FROM email_otps WHERE email = $1 ORDER BY created_at DESC`,
    [email],
  )).rows;
  assert.ok(otpRows.length >= 1, "an OTP row was issued");
  const otp = otpRows[0];
  assert.equal(otp.purpose, "verify");
  assert.equal(otp.student_id, row.id);
  assert.equal(otp.used_at, null, "freshly issued, not yet consumed");

  // The limited token must NOT satisfy requireVerifiedStudent — proven against
  // the real middleware via a live request, not by re-deriving it from the JWT.
  const probe = await fetch(apiUrl("/api/__test/verified-only"), {
    headers: { authorization: `Bearer ${json.accessToken}` },
  });
  assert.equal(probe.status, 403);
  const probeBody = (await probe.json()) as { requiresOtp?: boolean };
  assert.equal(probeBody.requiresOtp, true);
});
