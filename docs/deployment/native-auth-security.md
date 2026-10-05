# Native auth security — implementation and controlled-deployment gates

Source base: deployed API/worker `69fc1f978d668c222cd7267257c09583cf984b7c`.
Branch: `codex/native-auth-security`. Website companion branch:
`codex/native-auth-website-security`, based on deployed website
`d0d654fa10df09bf2b075bb3a7c788e3eb10f5cd`.

No deployment, production environment changes, new database migration, Cloudflare
changes, secret rotation, mobile changes, mobile builds or OTA publication.
No Turnstile experimental branches have been merged; mobile files are unchanged.

## IP integrity

The prior Railway probes did not adopt spoofed XFF/X-Real-IP canaries, but
Express's resolved IP did not match the edge source evidence. That does not
establish a trustworthy external-client extraction rule. This implementation
does **not** guess another proxy hop count or start trusting a header.

New costly-operation admission uses only a syntactically valid TCP socket peer,
normalizing IPv4-mapped IPv6. That peer may be the Railway proxy: it is expressly
a coarse secondary signal, **not verified client attribution**. Forwarded
headers, Express `req.ip`, UA, client platform and bundle identifiers do not
select new admission identities. Global/identifier controls remain authoritative.
Existing unrelated limiter fallback and Express proxy configuration are unchanged.

## Shared admission and accounting

`nativeAuthAdmission.ts` reserves all applicable dimensions atomically with one
Redis Lua script, server `TIME`, sorted sets, rolling-window cleanup, random
reservation IDs and bounded TTLs. Keys use a separate versioned namespace and
one Redis hash tag; recipient/peer identifiers use the existing domain-separated
HMAC pepper. No email, OTP, JWT or provider key is stored in counter keys.

No fallback: absent Redis, connection/command errors or malformed replies deny
costly operations. Native registration admission precedes bcrypt/DB writes;
web registration additionally keeps its mandatory Turnstile gate and shares the
same registration admission. Duplicates, lost acknowledgements, DB failures and
registration races never refund admitted attempts. Unavailable registration
returns 503; admission exhaustion returns 429 without account-existence data.

Every actual auth/security Brevo request through `authHelpers.ts` reserves the
same global budget before its only `fetch`. This includes verification/reset,
social ownership/deletion OTP and password-security notices. Recipient limits
always apply; student/peer limits apply when context is available. All existing
API Brevo send sites are centralized there. Requests returning 429/non-2xx,
transport failure or timeout stay charged, with no refund or automatic retry.
Existing independent DB issuance budgets/cooldown/attempt locks remain in force.
The existing DB cleanup of a failed-delivery OTP does not remove Redis history.

## Provisional launch defaults

All windows are rolling, not calendar-day or fixed-window counters. Overrides
are server-only positive integer environment settings; malformed overrides fail
startup. Defaults require owner approval before deployment and are not calibrated
permanent limits.

| Environment setting | Default | Scope |
| --- | ---: | --- |
| `NATIVE_REGISTER_GLOBAL_15M` | 10 | All admitted web/native registrations per 15 minutes |
| `NATIVE_REGISTER_GLOBAL_24H` | 100 | All admitted web/native registrations per rolling 24 hours |
| `NATIVE_REGISTER_EMAIL_1H` | 5 | Normalized registration email per hour |
| `NATIVE_REGISTER_PEER_1H` | 60 | Coarse TCP peer registrations per hour |
| `AUTH_RECOVERY_REQUEST_GLOBAL_15M` | 20 | Known/unknown recovery requests per 15 minutes |
| `AUTH_RECOVERY_REQUEST_GLOBAL_24H` | 200 | Known/unknown recovery requests per rolling 24 hours |
| `AUTH_RECOVERY_REQUEST_EMAIL_15M` | 5 | Normalized recovery email per 15 minutes |
| `AUTH_RECOVERY_REQUEST_PEER_15M` | 40 | Coarse recovery peer per 15 minutes |
| `AUTH_EMAIL_GLOBAL_15M` | 10 | All provider attempts per 15 minutes |
| `AUTH_EMAIL_GLOBAL_24H` | 200 | All provider attempts per rolling 24 hours |
| `AUTH_EMAIL_VERIFY_15M` | 5 | Routine verification subset per 15 minutes |
| `AUTH_EMAIL_VERIFY_24H` | 150 | Routine verification subset per rolling 24 hours |
| `AUTH_EMAIL_RECIPIENT_1H` | 5 | All provider attempts per normalized recipient/hour |
| `AUTH_EMAIL_RECIPIENT_24H` | 10 | All provider attempts per recipient/rolling 24 hours |
| `AUTH_EMAIL_STUDENT_15M` | 10 | Provider attempts per known student/15 minutes |
| `AUTH_EMAIL_PEER_15M` | 20 | Provider attempts per coarse TCP peer/15 minutes |
| `AUTH_EMAIL_TIMEOUT_MS` | 5000 | Brevo request deadline, no retry |

Rationale: auth can use at most 200 of the observed Free-plan 300 daily sends,
leaving 100 for unestablished other consumers/headroom. Routine verification
cannot consume the final 50 of the auth daily budget or final five of its burst
budget; recovery/security share that headroom. Peer ceilings exceed the fleet
ceilings so a shared Railway/carrier/school peer is not a tighter launch gate.
Identifier limits bound targeted spam. These controls cannot reserve capacity
against applications outside this backend using the same Brevo account. Owner
must establish their consumption before authorizing rollout or raising ceilings.

## Native contracts and shared services

- `POST /api/auth/native/register`: existing registration body and shared
  handler, no bot token; generic `{ok:true}` for new/existing/racing accounts.
- `POST /api/auth/native/send-email-otp`: limited/full student JWT; no body
  identity required or trusted. Shared legacy student-ID OTP handler looks up
  the JWT-authenticated ID's current email and uses existing `issueOtp` rules.
- `POST /api/auth/native/forgot-password`: `{email}`; public generic success
  for all valid inputs, including unknown/quota/unavailable outcomes. Resend
  uses this same endpoint, with no separate allowance.

Recovery's shared web/native handler reserves known/unknown requests equally,
then queues only student ID (or null) and optional socket-peer context using the
existing BullMQ/Redis infrastructure. Both account branches enqueue through the
same path. Public responses do not wait for Brevo: no artificial delay and no
provider-latency account oracle. `auth-password-recovery` is processed by the
existing worker. Delivery has one attempt, zero stalled-job retries; jobs older
than the existing OTP TTL are ignored. Completion/failure retention is removed.
An unknown account is a no-op. No email, OTP or JWT is queued.

The five web/legacy send/register/recovery endpoints retain mandatory
`requireBotToken` gates. No mobile/header/UA/platform bypass. Existing verify,
password-reset grants, token-version revocation and DB schema are unchanged.
Public locked-reset-code failures now share the generic 400 contract; the
internal five-attempt lock is unchanged.

## Website companion

`TurnstileWidget` supports `otp_send`. `AuthModal` requires a new in-memory token
for each explicit initial send/resend, clears a consumed token before awaiting,
resets the challenge and guards duplicate clicks. The existing website send and
resend BFFs forward `{email,botToken}` using cookie-derived email/JWT. Missing
tokens never reach upstream. `BOT_VERIFICATION_FAILED/UNAVAILABLE` does not clear
the valid cookie or become invalid-session 401. Website never uses native routes.
Social flows that already issue server-side OTP are not given an automatic extra
send. Signup/forgot-password widget actions remain unchanged.

## Contracts and deployment gates

The three additive endpoints are in canonical OpenAPI 3.1. Existing generator
regenerates React Query and Zod output; no hand-edited generated code or removed
legacy operation. No package version or lockfile change. Website package scripts
add the runtime BFF regression only.

Before any separately authorized controlled deployment:

1. Review the full verification report and provisional ceilings.
2. API **and worker** must use the same Redis logical DB and identical settings,
   existing `AUTH_ABUSE_PEPPER`, `OTP_PEPPER`, `STUDENT_JWT_SECRET`, Brevo key and
   sender configuration. The worker now imports OTP delivery configuration:
   confirm its existing secrets are present; do not generate/rotate replacements.
3. Keep the existing worker enabled (`QUEUE_WORKER_ENABLED=true`); recovery now
   requires this durable consumer. Monitor queue age and sanitized delivery events.
4. Redis must remain shared, persistent and protected from eviction/reset: a
   cleared/evicted budget is not a reservation history. Confirm appropriate Redis
   memory/persistence policy and retain headroom. No production policy was changed
   during this implementation.
5. Deploy compatible worker before API traffic; then deploy the website companion.
   Verify fresh web `otp_send` tokens and valid-session retention on bot failure.
6. Run controlled native endpoint smoke tests without connecting/releasing mobile
   changes in this phase. Check outage fail-closed behavior and non-enumeration.

Rollback: stop native rollout, return API/worker to the documented deployed base
and website to its base. Quiesce/drain the new recovery queue before removing its
consumer, so jobs cannot unexpectedly deliver after a later redeploy. Keep Redis
admission history until natural TTL expiry; do not flush/reset security counters.
No schema rollback or Cloudflare/secret changes are needed. Do not restore a mobile
Turnstile experiment as part of this rollback.

Implementation file inventory and verified test results are in the companion
`native-auth-security-verification.md` report. Nothing in this runbook authorizes
deployment or production environment mutation.
