# Native auth security — verification report

Implementation is isolated on `codex/native-auth-security` from deployed commit
`69fc1f978d668c222cd7267257c09583cf984b7c`. Website changes are isolated on
`codex/native-auth-website-security` from deployed website commit
`d0d654fa10df09bf2b075bb3a7c788e3eb10f5cd`.

**Nothing deployed.** No Cloudflare change, secret rotation, new database migration,
mobile edit/build, OTA, submission, merge to main or remote push.
Only guarded local disposable fixtures were used for database regression tests;
no production database schema or data was changed.

## Result

NATIVE AUTH SECURITY IMPLEMENTED — READY FOR CONTROLLED BACKEND DEPLOYMENT

This is readiness for owner-reviewed, separately authorized controlled rollout,
not deployment authorization or a claim that the whole repository is green.
The provisional launch settings and explicit Redis/worker/provider preflight
checks in the runbook must be reviewed before deployment approval.

## Verified focused coverage

140 focused backend/auth tests passed, zero failed. These exercise:

- Real Redis atomic admission across independent connections, concurrent HTTP
  registration, rolling-window expiry and retained 24-hour limits; bounded TTLs
  and no partial multi-dimension reservation on denial.
- Normalized identifiers, admitted duplicate registration accounting, no raw
  email in Redis keys, and spoofed XFF/X-Real-IP not choosing admission identity.
- Missing/unreachable Redis fail-closed; registration denial before bcrypt or
  account creation, authenticated OTP denial before any provider request.
- Brevo 500/429/timeout still consuming admission, no retry, security notices
  sharing the budget, and exhausted admission avoiding provider calls.
- Native registration/recovery/OTP without Turnstile; limited student JWT
  required for OTP and body email/student-ID unable to redirect delivery.
- All five web/legacy routes rejecting missing/invalid Turnstile despite mobile
  headers; registration and OTP aliases sharing admission.
- Generic registration/recovery responses, locked reset code outward equality,
  queued recovery with no recipient/OTP/JWT payload and real worker delivery.
- DB OTP cooldown, shared hourly/daily issuance budget, internal five-attempt
  lock, expiration, digest-at-rest, replay rejection and concurrent consumption.
- Single-use reset grants, old JWT revocation, password change/logout/session
  compatibility, and mandatory web bot verification.

Late/lost Redis acknowledgements during CPU pressure deny the request even if
Redis already reserved it. The reservation is never refunded. HTTP concurrency
tests allow safe 503 outcomes but assert the global count cannot exceed its cap;
the separate real-Redis concurrency test proves exact atomic admission.

Website: 228 existing/new tests passed, including four runtime BFF/UI contract
tests. The real BFF forwards distinct fresh `otp_send` tokens on send/resend,
uses cookie-derived identity, preserves the cookie on bot failure and rejects
missing tokens before upstream. Website TypeScript check passes.

API and worker local compilation passes. Canonical Orval React Query/Zod
generation and workspace-library TypeScript build pass. Mobile TypeScript check
passes with no mobile changes.

## Existing regression debt

The deployed backend baseline was tested, not assumed green. Its full run had
3,004 tests: 2,089 passed and 915 failed. Failures include unavailable local
fixtures (e.g. notification DB port 5602), missing test-only direct dependency
resolution, schema/seed expectations and stale source assertions. No claim is
made that those are all harmless production issues. Unrelated debt was not
silently fixed or waived by this implementation.

Final source: **3,021 tests, 2,155 passed, 866 failed**, zero cancelled/skipped.
All 866 failed-test names/file identities also fail on the deployed baseline;
there are **zero new failed-test identities**. This comparison does not establish
identical error causes or waive existing failures. Baseline had 915 failures;
the implementation adds 17 passing tests and resolves 49 prior test failures in
this run, including relevant stale auth fixtures. Existing mutable local seed
state can also affect broad-suite outcomes; no claim is made that those 49 were
production defects fixed by this change.

Redis-required registration fixtures were updated rather than weakening
production admission. Recovery assertions now run the worker processor instead
of assuming delivery happens before HTTP success. Password-reset fixtures
comply with the already-existing punctuation policy.

Raw local reports (not credentials or production request data):

- `/private/tmp/native-auth-release-regressions.xml` — final full backend run
- `/private/tmp/native-auth-baseline-full.xml` — deployed baseline full run
- `/private/tmp/native-auth-focused-approved.xml` — 140/140 focused auth tests
- `/private/tmp/native-auth-final-website-tests.log` — website suite
- `/private/tmp/native-auth-mobile.xml` and
  `/private/tmp/native-auth-baseline-mobile.xml` — matching mobile failures
- `/private/tmp/native-auth-verified-types.log` and
  `/private/tmp/native-auth-baseline-typecheck.log` — existing backend type debt

Backend TypeScript reports 173 errors on both baseline and implementation,
with matching file/diagnostic-code multiplicities; no new diagnostic in the new
admission/recovery code. This is **not** a clean backend typecheck.

Mobile's full practical suite has 480 test entries: 452 pass, 28 fail on both
checkouts. Failed-test names match test-for-test; mobile source is byte-for-byte
unchanged. Existing failures are in Ballet layout/selector/application refresh,
booking status/participant mapping and package purchase-channel assertions.
These were not waived by changing mobile code or weakening tests.

## Exact changed files

Backend checkout:
`/Users/abdelrahmanomar/.codex/worktrees/native-auth-security/Central-Studio-System-main`

All entries below are repository-relative paths within that checkout.

Production implementation:

- `artifacts/api-server/src/lib/authAbuseProtection.ts`
- `artifacts/api-server/src/lib/nativeAuthAdmission.ts` (new)
- `artifacts/api-server/src/lib/authRecovery.ts` (new)
- `artifacts/api-server/src/lib/authHelpers.ts`
- `artifacts/api-server/src/routes/auth.ts`
- `artifacts/api-server/src/routes/emailOtp.ts`
- `artifacts/api-server/src/worker.ts`

Canonical/generated contracts:

- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`

Tests and isolated fixture setup:

- `artifacts/api-server/src/lib/authAdmissionTestFixture.ts` (new, test-only)
- `artifacts/api-server/src/lib/nativeAuthAdmission.test.ts` (new)
- `artifacts/api-server/src/routes/nativeAuth.integration.test.ts` (new)
- `artifacts/api-server/src/lib/authHelpers.emailProvider.test.ts`
- `artifacts/api-server/src/lib/authHelpers.otpAtRestSecurity.integration.test.ts`
- `artifacts/api-server/src/lib/authHelpers.otpSendLimits.integration.test.ts`
- `artifacts/api-server/src/routes/authAbuseFoundation.integration.test.ts`
- `artifacts/api-server/src/routes/auth.sessionRevocation.integration.test.ts`
- `artifacts/api-server/src/routes/auth.security04b.integration.test.ts`
- `artifacts/api-server/src/routes/auth.security04b.routeMatrix.integration.test.ts`
- `artifacts/api-server/src/routes/students.accountLifecycle.integration.test.ts`
- `artifacts/api-server/src/routes/students.concurrentPatch.integration.test.ts`
- `artifacts/api-server/src/routes/students.creationProvenance.integration.test.ts`
- `artifacts/api-server/src/routes/students.emailProvenance.integration.test.ts`
- `artifacts/api-server/src/routes/students.overviewLifecycle.integration.test.ts`

Documentation:

- `docs/deployment/native-auth-security.md` (new)
- `docs/deployment/native-auth-security-verification.md` (this new report)

Website checkout: `/private/tmp/central-native-auth-website` (separate Git
worktree; original website checkout was not edited).

- `components/AuthModal.tsx`
- `components/TurnstileWidget.tsx`
- `lib/AuthContext.tsx`
- `lib/auth/otp.ts`
- `lib/auth/otp.contract.test.mjs` (new)
- `package.json` (test scripts only; dependency versions unchanged)

## Safety, configuration and rollback

Diff checks pass. Scoped secret/private-file scans found no added production
key/private-key/provider-token patterns or credential artifacts. No added token,
OTP, JWT, email or cookie logging. API dependencies, backend package metadata,
all lockfiles, mobile files and DB schema/migrations are unchanged. Generated
files contain additive native operations only and were not hand-edited.

The [implementation runbook](native-auth-security.md) records exact launch
ceilings, IP limitations, native contracts, worker requirements and rollback.
No new secrets are required. Before deployment approval, verify the worker has
the existing API OTP/provider configuration and both use the same Redis DB,
pepper and ceiling settings. Redis persistence/eviction policy and other Brevo
consumers are explicit owner preflight checks, not claims established here.

The React review guided explicit click-driven sends, an in-flight guard and
pre-await token consumption instead of effect-driven automatic sends. The
Next.js guidance kept BFF authentication/error handling on the server and
challenge tokens in browser memory, with no native-route website shortcut.

Future mobile wiring/removal is a separate phase. The currently installed mobile
app still uses its existing routes; this un-deployed backend work does not claim
to resolve the physical iPhone UX yet.
