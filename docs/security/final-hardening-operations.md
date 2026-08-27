# Central Studio security operations runbook

Last repository review: 2026-08-26. This document contains procedures and
configuration names only. Never paste credential values, database dumps, OTPs,
access tokens, signing private keys, or customer records into tickets or logs.

## Ownership and recovery targets

- The production owner must name a primary and backup operator for Railway,
  Vercel, EAS/Expo, Cloudflare, Firebase/Google Cloud, Meta, Brevo, Sentry, and
  the secret manager/password vault.
- Provisional production targets: PostgreSQL RPO <= 24 hours and RTO <= 4 hours.
  PITR should reduce the practical RPO below that target. Confirm these targets
  with the business owner and record the measured restore-drill result.
- Redis rate-limit counters are intentionally ephemeral. BullMQ jobs are
  operational state, not the system of record; after Redis loss, reconcile
  pending database records and re-enqueue only idempotent work. Target queue
  recovery within the PostgreSQL RTO.

## Third-party credential inventory

| Credential | Storage/readers | Rotation posture |
| --- | --- | --- |
| Instagram long-lived token | Encrypted in PostgreSQL with AES-256-GCM; current/previous encryption keys exist only on the Railway API service. A Railway API secret may bootstrap or deliberately replace it. It is never returned by an API. | Provider-token revision label triggers an encrypted replacement. Encryption envelope is versioned and rewrapped on read. |
| WhatsApp Cloud access token | Railway server/Worker secret; read only by the send worker/API integration. Never a mobile/admin public variable. | Rotate in Meta, update the server/Worker secret, perform one test-recipient send, revoke the old token. |
| Brevo API key | Railway API secret; read by transactional email delivery only. | Create new key, deploy API, verify one synthetic delivery, revoke old key. |
| Facebook App Secret | Railway API secret; used for server-side token validation. | Create/activate replacement, deploy API, verify synthetic social sign-in, revoke old secret according to Meta's overlap support. |
| Facebook Client Token | Native build/EAS secret; embedded in the native client by design and not an App Secret. | Replace in EAS and issue a new native build when required. |
| Turnstile secret | Railway API secret only. Site key is public. | Introduce replacement in Cloudflare/API using the provider's supported overlap, verify synthetic protected requests, then revoke old secret. |
| Sentry DSN | Client identifier, not an ingestion/admin secret. | Restrict project access and rate limits. Keep Sentry auth/upload tokens in build secrets only. |
| Firebase client API key | Public Firebase client configuration in the Android app. | Restrict by app/API in Google Cloud; do not treat it as server authorization. |

Provider scopes must be reviewed in their consoles at least quarterly. Instagram
and WhatsApp tokens should have only the permissions required by reels-read and
approved-template-send behavior. No repository evidence can prove live provider
scope or revocation state.

### Instagram provider-token rotation

1. Create the replacement token in Meta without revoking the active token.
2. Set `INSTAGRAM_ACCESS_TOKEN` and a new opaque
   `INSTAGRAM_ACCESS_TOKEN_REVISION` on the Railway API service only. Do not put
   either on the Worker, Admin, Mobile, Website, or in `EXPO_PUBLIC_*` values.
3. Deploy the API. A differing revision makes the API encrypt the replacement
   before persisting it; the token itself is never written to an application log.
4. Verify the reels response and confirm the DB row has a null legacy
   `access_token`, complete envelope fields, and the new non-secret revision.
5. Remove the two bootstrap variables, redeploy, verify again, then revoke the
   prior provider token. Keep no plaintext copy outside the approved vault.

### Third-party encryption-key rotation

1. Generate a new independent 32-byte key and store it as base64 in the vault.
2. Move the old current key into the JSON decrypt-only
   `THIRD_PARTY_TOKEN_PREVIOUS_ENCRYPTION_KEYS` map under its old version.
3. Set the new key and a new `THIRD_PARTY_TOKEN_ENCRYPTION_KEY_VERSION` on the
   API service. Deploy. The first successful read rewraps the token with the new
   key; provider credentials are not rotated by this operation.
4. Confirm the DB `encryption_key_version` is current and the integration works
   after another API restart. Only then remove the old key from the previous map.
5. Never reuse JWT/OTP/rate-limit/provenance keys as an encryption key.

## Secret rotation

- `STUDENT_JWT_SECRET` and `ADMIN_JWT_SECRET`: a one-step change intentionally
  invalidates all corresponding sessions. Announce a maintenance window, rotate
  independently, deploy, verify fresh login, and record the forced sign-in event.
- `OTP_PEPPER`: rotation invalidates only still-live OTP digests. Stop issuing
  OTPs, wait at least the configured OTP TTL, rotate, deploy, then resume and
  verify one synthetic OTP flow. Do not attempt to backfill OTP values.
- `AUTH_ABUSE_PEPPER`: deploy a new independent pepper knowing the temporary
  rate-limit key namespace will start empty; retain the old deployment for quick
  rollback only and monitor abuse during the transition.
- Identity-provenance pepper: it protects durable fingerprints. Do **not**
  rotate it in one step. First implement versioned fingerprints and dual-read,
  backfill under controlled evidence, then remove the prior pepper only after
  every durable row is on the new version.
- Database, Redis, Railway, Vercel, EAS, Firebase service-account, Meta, Brevo,
  and Sentry service secrets: use provider overlap where available. Deploy new,
  verify a synthetic action, then revoke old. Never expose server secrets to a
  browser/mobile bundle.
- Every rotation record contains owner, date, credential name, old/new version
  labels, verification evidence, and revocation confirmation—never values.

## PostgreSQL and Railway backup/restore

Railway documents three complementary layers: scheduled volume backups, PITR,
and portable logical dumps. See the official
[backup/restore guide](https://docs.railway.com/guides/postgres-backups-restores)
and [PITR documentation](https://docs.railway.com/volumes/point-in-time-recovery).

Production owner checklist:

1. In PostgreSQL **Backups**, confirm daily, weekly, and monthly volume schedules
   and their displayed retention. Confirm the latest backup succeeded.
2. Confirm PITR is enabled, archiving is healthy, and the displayed recovery
   window is usable. A read-only CLI check may use
   `railway postgres pitr status --service <postgres-service>`.
3. Produce an encrypted off-project logical dump at least daily. Restrict its
   bucket/account separately from the Railway project and test its integrity.
4. Keep deployment/source revision and migration journal evidence beside each
   backup timestamp, not secret values.
5. Never rely on a same-volume backup alone: deleting/wiping that volume can
   remove its snapshots. Never run a production restore simply as a test.

### Encrypted offsite logical backup

The `central-studio-backup-cron` Railway service is the portable offsite layer.
It has no domain, runs at `0 2 * * *` UTC, and must exit after every run. The
owner checks its latest deployment and status-only runtime log in Railway under
**central-studio-backup-cron → Deployments/Logs**. Railway skips a scheduled
execution while the prior execution remains active, so an active prior run is
an operational alert rather than permission to start a concurrent dump.

The service receives only the dedicated read-only PostgreSQL URL, the public
age recipient, and the Google Drive OAuth/folder variables. The age identity is
owner-held offline and must never be entered into Railway, Git, Drive, tickets,
or logs. The job verifies the custom archive, encrypts before upload, verifies
remote size and checksums, and only then applies the union of seven daily and
four Sunday weekly restore points. A failed dump, integrity check, encryption,
upload, or remote verification exits nonzero and performs no retention delete.

For restore drills, download one encrypted object to an operator-controlled
temporary directory, decrypt only with the offline identity, and restore with
`pg_restore --no-owner --exit-on-error` into an isolated temporary database.
Remove the local plaintext after validation. Do not connect any production
application to the restore database, and do not delete the restore resource
until the owner approves cleanup.

Quarterly non-production restore drill:

1. Select a recent logical dump and provision an isolated disposable database.
2. Disable Worker scheduling and all email, push, WhatsApp, payment, and other
   outbound side effects in the drill environment. Do not point a public client
   at it.
3. Restore with `pg_restore`, run migrations only after recording the dump's
   migration state, then execute read-only row-count, constraint, and application
   health checks. Use synthetic fixtures for any functional write.
4. Record backup age (measured RPO), elapsed recovery time (measured RTO),
   checksum, operator, and failures. Delete the drill environment and encrypted
   dump copy according to retention policy after evidence is approved.

## Redis, queues, Vercel, and environment recovery

- Redis credentials stay private to API/Worker. No BullMQ dashboard or Redis
  port may be exposed publicly. Jobs have bounded retries/backoff/concurrency;
  completed and failed histories are bounded. Failed-job monitoring must alert
  on sustained failures and include queue/job IDs, never payloads.
- After Redis loss, inspect database campaign/report/automation state, reconcile
  in-flight status, and re-enqueue only through existing idempotent paths. Do not
  replay raw Redis payloads from untrusted files.
- Vercel applications are rebuilt from the exact Git SHA. Quarterly, record the
  project/team owner, production domains, Git connection, and a variable-name
  inventory. Back up configuration names/ownership separately; store variable
  values only in the approved vault. A Preview is never a Production restore.
- Railway environment recovery uses the same variable-name inventory and vault.
  Scope API-only keys to API and Worker-only keys to Worker; do not use shared
  environment groups when that would broaden access.

## Expo/EAS Updates

Repository state: the mobile app uses the `appVersion` runtime policy, the
expected EAS project update URL, and separate `preview`/`production` channels.
Code signing is not configured. Preview is internal but currently points at the
production API; provision a non-production API/data environment before treating
Preview as a safe staging lane. No EAS build was performed in this sweep.

Unsigned updates still use HTTPS and Expo's update controls, but they are not
end-to-end signed by an owner-controlled key. Expo documents that code signing
protects against modification by intermediaries and EAS itself. It requires an
owner-controlled certificate/private-key lifecycle and a new native build, and
is available only on eligible EAS plans. Follow Expo's official
[code-signing guide](https://docs.expo.dev/eas-update/code-signing/):

1. Confirm the EAS plan and name two key custodians.
2. Generate the private key outside the repository. Store it in KMS/vault; never
   upload it as a general project file or print it in CI. Commit only the public
   certificate when the owner approves the native release.
3. Configure `updates.codeSigningCertificate` and
   `updates.codeSigningMetadata`, increment the native runtime/app version, and
   create new Preview builds first. Existing binaries cannot gain a certificate
   through an over-the-air update.
4. Publish signed Preview updates with an explicit private-key path, verify
   signature rejection/acceptance on real devices in Final Security QA, then
   build/release Production and publish only the exact approved artifact.
5. Roll back with `eas update:rollback <group-id> --private-key-path <path>` or
   a signed roll-back-to-embedded update. Preserve the prior private key until
   all binaries trusting its certificate have aged out.

## Firebase and Google Cloud restrictions

Repository evidence shows one Android Firebase client for package
`com.centralstudio.app`, one public client API key, and no committed iOS plist.
No Firebase service-account private key or Google client secret is embedded in
the mobile app. Firebase explains that client keys identify a project rather
than authorize data access, but still require application/API restrictions; see
[Firebase API-key guidance](https://firebase.google.com/docs/projects/api-keys).

Manually verify in Google Cloud/Firebase:

- Android key: application restriction exactly matches
  `com.centralstudio.app` and every legitimate release SHA certificate; remove
  obsolete/debug SHA certificates from production and restrict APIs to the
  Firebase/Google APIs actually used.
- Android Google OAuth clients: package and release SHA bindings match the
  store/EAS signing certificates. Remove unknown clients and redirect URIs.
- iOS, if enabled later: create a distinct client for bundle ID
  `com.centralstudio.app`, apply bundle restrictions where supported, and keep
  any server client secret off-device.
- Web, if enabled later: use a distinct Browser key with exact HTTPS referrer
  restrictions and required-API restrictions. Never reuse the Android key.
- Review Firebase Security Rules, IAM owners, service accounts, OAuth consent
  screen, quota alerts, and App Check separately; API-key restrictions do not
  replace authorization.

## Audit, retention, and operational evidence

- Ordinary Admin APIs expose read-only access to `admin_activity_logs`; they do
  not update/delete that table or `promotion_audit_logs`. Writes go through
  append-only helpers. Database owners/migration roles remain technically able
  to alter rows, so restrict those roles, monitor migrations, and include audit
  tables in backup/retention evidence.
- Migration `0123_social_link_challenges_reconciliation` is a forward-only,
  idempotent repair for the historical 0119/0120 journal timestamp collision.
  Verify after deployment that `social_link_challenges` and both intended
  indexes exist; never rewrite already-shipped journal timestamps.
- Approve and document an audit retention period before implementing purge.
  Any future purge must be a named maintenance operation with before/after
  counts and backup evidence, never a general Admin endpoint.
- Quarterly checks: Railway backup/PITR status and restore drill; Vercel/Railway
  owners and variable scopes; Expo signing/channel state; Firebase restrictions;
  provider scopes; failed-job alerts; and secret-rotation dates.

## Dependency residuals

- Compatible security pins cover the API-runtime IP parser and affected Expo
  toolchain versions of tar, PostCSS, Nanoid, Fast URI, JS-YAML, shell-quote,
  brace-expansion, and Undici. The public website separately pins patched
  Nanoid/PostCSS/Sharp releases and must remain on Vercel Node 24 or another
  Sharp-supported runtime.
- The remaining high advisories are denial-of-service loops in `image-size`
  parsers reached through Metro. The registry currently declares no patched
  release. Metro is build tooling, not an API/mobile runtime parser; do not run
  it against untrusted ICNS/JXL/HEIF assets, and adopt the upstream patch when
  Expo/Metro makes one available.
- The remaining moderate UUID advisory affects namespace UUID methods only when
  a caller supplies an output buffer. Audited consumers use `v4()` without a
  buffer (ExcelJS, Expo ngrok, and Xcode tooling), so the vulnerable path is not
  reachable. Do not force these transitive consumers across UUID majors; update
  them through their owners.

## Final Security QA carryover

- Configure and real-device test owner-controlled Expo Updates code signing.
- Move Preview builds to a non-production API/data environment.
- Verify live Firebase/Google key and OAuth restrictions in console.
- Confirm Railway schedules/PITR and execute a non-production restore drill.
- Confirm alert routing for retained BullMQ failures and provider failures.
- Exercise one signed update rollback, one synthetic provider-token rotation,
  and one encryption-key rewrap in a non-production environment.
