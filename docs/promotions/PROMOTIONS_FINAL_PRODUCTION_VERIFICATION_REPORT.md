# FINAL PRODUCTION VERIFICATION REPORT — PROMOTIONS

2026-10-26. **PARTIAL execution; iOS-only Production release IN PROGRESS; Android distribution explicitly deferred by Owner. The Build 13 source/runtime and migration-ledger blockers remain resolved.** Existing release authorization remains valid; no new general release approval is requested.

## iOS-only continuation — Owner decision, 2026-10-26

Owner explicitly deferred Google Play distribution. The existing successful Android build is retained; no submission, credentials setup or rebuild will be attempted. Existing Android clients remain supported with mandatory idempotency/revision enforcement disabled. Android distribution is no longer a gate to independently safe iOS release work.

Railway Git sources are temporarily disconnected for the existing API, Worker and backup services to prevent unordered deployments. Vercel Admin automatic domain assignment is false and its Git ignored-build command is `exit 0`; both settings were read back. Existing live deployments remain unchanged at this point. These are temporary release-order controls, not application changes. All prior implementation/test evidence is retained. Final deployment and actual iPhone smoke acceptance remain required before CLOSED/PASS.

## Earlier Android attempt — 2026-10-26 actual result

The existing Android native build **`4ad3046d-f9d0-42d6-9698-776de647bcf3`** finished successfully at **2026-10-25 12:01:54 UTC** (15:01:54 Africa/Cairo). Metadata verifies Android, SDK 57, runtime `1.0.0`, Production channel, STORE distribution and source `ccb3fcc8453c397a1001720100721aebc0f316dc`. No replacement build is needed. This is build success, not store distribution or installed-device verification.

**Genuine release blocker: configured Google Play submission credentials are unavailable.** The approved production submission profile points to `./google-services-key.json`, which is absent in the verified Mobile worktree, combined release worktree and original checkout. One bounded submission attempt used:

```sh
eas submit --platform android --profile production --id 4ad3046d-f9d0-42d6-9698-776de647bcf3 --non-interactive --no-wait
```

It failed before uploading or creating a submission: `File ./google-services-key.json doesn't exist` and `A Google Service Account JSON key is required`. A separate narrowly scoped authenticated EAS metadata query requested only the credential relationship's ID (no key material) and confirmed one Android credential record for `com.centralstudio.app`, **no submission key assigned**. Existing build signing does not establish Google Play submission permission. No new credentials were created, retrieved or changed. The wrapper's later shell variable error did not cause the EAS failure; the saved EAS log records the missing-key failure independently, and the command was not retried.

Private evidence: `/tmp/promotions-mobile-recovery-20261025/android-build-current.json`, `android-submission-attempt.log`, `android-submission-metadata.json`. No credential value is included. Existing source also documents an open first-Play-release signing gate in `docs/security/final-hardening-operations.md`: Play App Signing fingerprints must be present in the existing Firebase/API-key/OAuth bindings, and push/auth must be verified on a Play-installed build. Those current external bindings and Play enrollment are **unverified**, not claimed absent merely from historical documentation.

**Smallest resolution:** privately provide/assign the existing authorized Google Play submission service-account key through the approved EAS/Play procedure (never chat), then verify the documented Play-signing bindings and distribute this already completed AAB to the configured internal track. If no such credential or Play setup exists, establishing it requires Owner/operator action; it cannot be inferred from EAS build access or bypassed by publishing an SDK-57 OTA to the old SDK-54 Android preview. Expo's official procedure: https://docs.expo.dev/submit/android/ . No general Promotions release approval is missing.

Release stopped before source push, trigger changes, writer pause, migration, cleanup or application rollout. Remote main still resolves to `2b3ab9f5e3568f90ee468707a19992f7b229fb2c`; no remote Promotions branch was present in the checked refs. Existing Railway API/Worker sources and Admin settings were left unchanged. No new backup, repeat inventory, engine tests, Production business query or smoke fixture was run. Previously verified evidence remains applicable; no final Production GO is claimed. Once the Android distribution prerequisite is satisfied, resume the same approved sequence; do not repeat completed engineering, TLS or ledger investigation.

## Migration preflight parser correction — Owner follow-up

The Owner's private preflight reached JSON parsing after the SSH command returned exit 0. With `psql ON_ERROR_STOP=1` and the unchanged SQL batch, this indicates the three read-only metadata SELECTs and COMMIT completed normally. That first attempt could not be recovered: stdout existed only in the terminated Python process, and parsing failed before either result file was written. The Owner subsequently completed the corrected read-only preflight; its saved output supports the ledger assessment below. No migration or business-data mutation was part of that command.

**Root cause reproduced exactly:** PostgreSQL 18 `json_agg(record)` inserts physical newlines between ledger rows. Parsing `stdout.splitlines()` therefore split one valid JSON object into invalid fragments. A synthetic 137-row ledger reproduced **`Expecting value: line 1 column 150 (char 149)`**, exactly matching the Owner's error, in a newly created Unix-socket-only disposable database. That database was stopped after reproduction; no Production command was run during this repair.

The local launcher now uses a strict JSON stream decoder across line breaks, preserves bounded stdout privately **before parsing**, requires all three unique expected records plus a shell completion marker emitted only after successful psql exit, and rejects malformed/truncated/extra output. A failed attempt removes stale result summaries. Capture ceiling is 64 KiB; the existing 150-row ledger bound, read-only transaction, target, TLS, private password handling and timeouts remain intact. Tests assert the approved SQL and connection arguments are byte-identical to the original launcher. No role, grant, schema, credential or business rule changed.

**Local verification: 29 tests passed, zero failures/skips.** Coverage includes actual PostgreSQL multiline output, CRLF/public SSH banner, full-size synthetic ledger, malformed/truncated/duplicate/oversized output, missing completion, wrong target/hash rejection, private capture before failure, nonzero SSH refusal, and password-echo restoration. Launcher tests mock SSH and save synthetic results only in isolated temporary test directories; they create no false Production PASS artifact. Exact command: `python3 -m unittest -v test_preflight_output.py test_preflight_launcher.py`, from `/tmp/promotions-mobile-recovery-20261025/`; evidence is `parser-and-launcher-tests.log` and `parser-reproduction-evidence.json`.

Changed local files: `production-migration-preflight.command`, sibling `preflight_output.py`, and the sanitized reproduction/tests under the same private evidence directory. The original launcher is preserved as `production-migration-preflight.before-parser-fix.txt`. The Owner subsequently performed the necessary private execution successfully. No further private execution is required to resolve the ledger discrepancy; the saved capture is sufficient. No automatic retry or migration occurred during either local repair.

## Build 13 recovery and preservation

The implementation was recovered from surviving files and independently retained published artifacts. Original Git objects `78db255611d790e5f0ae5617f6f8fa962c211fc7` and `b877765d683a549b6296732d9b2b7246e5a824f5` remain unavailable; reconstructed commits are **not** represented as those original objects.

- All **1,601/1,601** frozen files match the existing reconstruction manifest in both the untouched frozen directory and the explicitly labelled reconstruction.
- All **176/176** recorded application modules match the retained published Build 13 QA source map; all **134/134** retained OTA export files match checksums. No mismatch.
- Current Production EAS iOS group `86b64d63-db40-4120-a3de-bf69b04d6ed9` includes the subsequently published Children/Ballet Mobile safeguards. Its source baseline `6b20c9aa332db8029b3aeb2e2844da5336f53e54`, rather than the older reconstruction alone, was preserved. All **177/177** application-module manifest hashes match that baseline.
- The Promotions change on that baseline is local commit **`ccb3fcc8453c397a1001720100721aebc0f316dc`** on `codex/promotions-build13`: booking flow plus the existing helper and its three tests. Only the flow differs among the previous 177 compiled application modules; the helper adds one module.
- Integrated verified Mobile source into the existing combined release worktree as **`b0e2a4fbefbb2a75496be84dc1b81a978489c326`**, branch `codex/promotions-phase1a`. All **344 tracked Mobile files** match the verified Mobile candidate. The 85-file integration restores already approved/live OTP, QA and capacity implementation missing from the older Promotions checkout; it is not an additional feature redesign. The restored lockfile changes only the Mobile importer; all other importers are identical. Generated clients, Backend, Worker, Admin and database source are unchanged from the capacity-preserving candidate `c5218d2`.

Frozen source and original dirty Downloads working files were not modified. A new attached Mobile worktree was used at `/Users/abdelrahmanomar/.codex/worktrees/promotions-build13/Central-Studio-System-main`. No original history was forced or invented. Remote main remains `2b3ab9f5e3568f90ee468707a19992f7b229fb2c`; nothing has been pushed or remotely merged.

## Mobile compatibility and verification

| Check | Actual result |
|---|---|
| Focused OTP/authentication, account capacity and Promotions tests | **79 passed; 0 failed/skipped/TODO** |
| Promotions activation helper alone | **3 passed**; included in focused/full results, not an additional combined total |
| Full Mobile suite, recovered Mobile worktree | **685 executed: 661 passed, 24 failed, 0 skipped/cancelled/TODO** |
| Full Mobile suite, combined release worktree | Same **685 / 661 / 24**; exact same 24 inherited failure names as the previously recorded live Mobile baseline; zero new failures. This suite is **not** called passing. |
| Mobile TypeScript, both worktrees | **PASS**, exit 0, zero diagnostics |
| Combined API build / Admin production build | **PASS / PASS**, exit 0 |
| API TypeScript | Prior combined check remains **FAIL: 167 inherited diagnostics**, accepted by Owner; no Backend/type source changed during recovery. Not reclassified as a passing typecheck. |
| Existing combined Backend capacity tests | Prior **36/36 PASS**, reused because Backend source is unchanged |
| Prior Promotions/financial/inventory verification | Existing 372-test closure, 43 focused release tests and 51 inventory tests retained as separate evidence sets; no repeat inventory or unnecessary full engineering investigation |
| Whitespace | Restored `PriceTagIcon.tsx` retains its published source's extra EOF blank line; staged source check reported this inherited warning. OTP/QA source was preserved byte-for-byte. |

The fix still forwards the entered, normalized manual activation code for direct-class pay-at-studio bookings when the selected quote has no code. Package-credit exclusions, quote/final-price mismatch protection, ownership, usage limits, financial allocation, audits and optional enforcement behavior are preserved.

**iOS:** existing SDK 57 Build 13 (`18da1cff-8737-43b5-a079-d514c08c36c0`) has the preserved platform-specific **`1.0.0-otp13`** override. Global `appVersion` policy alone does not describe its resolved iOS runtime. Fresh comparison against the live update verifies all **15 native plugins and parameters**, bundle/project identity, update URL and configuration match. No runtime or native configuration change was made. Production-environment local iOS export **passed**; all **178/178** checked application modules match intended source. Hermes bundle SHA-256: `6a834d6dc642feaa4d30dc765a81f989d2e47cf5b6bb02dda461c406a358602c`. iOS can follow the existing **iOS-only OTA** path after API readiness; no duplicate iOS native build was started. No new OTA or installed-device acceptance is claimed.

**Android:** latest existing build `2192c13f-e5e1-4621-9aef-ecb18eeb84c9` is an SDK 54 internal preview, runtime `1.0.0`, preview channel. Matching runtime text does not make it compatible with SDK 57. The store-build query returned no existing Android store build. One necessary SDK 57 native candidate was started from verified Mobile commit `ccb3fcc`, with existing Production profile/signing, `--freeze-credentials`, no automatic submission: **`4ad3046d-f9d0-42d6-9698-776de647bcf3`**. Updated 2026-10-26: **FINISHED**, Production channel, STORE distribution, runtime `1.0.0`, versionCode 1; completed 2026-10-25 12:01:54 UTC. Submission is blocked as described above. No Android OTA was published, no credential changes made, and no store/device acceptance claimed. Available local space was **6.3 GiB** before starting the cloud build; no local native compilation was attempted.

## Actual Production actions and current gates

1. Redeployed the **existing encrypted backup service only**, preserving its existing source/configuration/schedule: deployment **`4ca69243-cccd-4d98-afeb-943f3f39c408`**, image `sha256:4e26d0d3a41ea16a60dd8a88df7038344b60d809fbbcd97f67b91f57eff8cf90`. Redeployment alone was not counted as a backup.
2. Triggered one on-demand run using the existing cron mechanism: run **`0619c7c8-0e7c-4311-af17-659a2f8bc332`**, exited 2026-10-25 **11:28:49 UTC**. Sanitized structured log confirms **backup_status=success**, dump 741,553 bytes, encrypted file 741,929 bytes, remote integrity verification complete. Encrypted checksum: `06f20389245af38b6f9ed36f8477c4a81eb76c63087dbfaf91eaf859ddb1a7f4`. Existing retention policy reported `kept:10,deleted:1`; it was not changed. The job validates archive structure with `pg_restore --list`; no fresh decryption/restore rehearsal is claimed. Owner separately confirmed the existing recovery key is available privately.
3. Verified the existing registered Railway SSH key and exact Production PostgreSQL service/instance transport. Read only public certificate paths/metadata: existing CA validates server certificate, subject/SAN `localhost`, valid through September 5, 2028. No keys, credentials, roles, networking or certificates were created/changed. This authenticated service-bound transport supports service-local `verify-full`; no TCP hostname-verification downgrade was made.
4. Read aggregate monitoring: last-hour API **5 requests, 0 4xx/5xx**, database average approximately **0.00035 vCPU**, memory approximately **91 MiB** at the recorded check. No customer-level log/data output.

**Read-only preflight completed by the Owner:** the saved capture verifies database `railway`, user `postgres`, TLS active, `REPEATABLE READ`, `read_only=on`, non-replica, and no operations table. The original exact-prefix check rejected the historical ledger; the offline assessment below resolves that check without another Production query or private password entry.

## Migration-ledger discrepancy — resolved offline

**Root cause: an incorrect complete-prefix/count assumption in the local preflight, combined with known historical journal irregularities.** Candidate history contains 137 entries before 0137; Production contains 124. First positional divergence is row 2: candidate `0001_add_student_password` (`1749455400000`, hash `96f4be75d3d96412f6819a0d949acd7a6fb153b2bf9548a8367a3baf5d8c63c0`), versus recorded `0012_class_pricing_settings` (`1781697600000`, hash `11b820681c47b1ae073a9072636d5eaf9fdd6b09c28e8b40a39d0622cd5377ab`). Row 1 matches 0000 (`1780894693548`); 0001–0011 are backdated below that entry. The installed runner does not select pending migrations by missing ledger rows.

The exact 13 unrecorded historical identities are:

- `0001_add_student_password`, `0002_package_updates`, `0003_hero_items`, `0004_instructor_extras`, `0005_ensure_hero_items`, `0006_email_otp`, `0007_admin_role_access`, `0008_qr_attendance`, `0009_ballet_children`, `0010_age_group`, `0011_dance_types`.
- `0060_ballet_schedule_capacity`: timestamp collides with 0059. Existing forward repair `0069_restore_ballet_schedule_capacity` documents the incident and is recorded with its exact current hash.
- `0120_social_link_challenges`: timestamp collides with 0119. Existing forward repair `0123_social_link_challenges_reconciliation` documents the incident and is recorded with its exact current hash.

Separately, recorded 0068 has the original hash `b2daa0a27094c35389ed9d299240e7f4d483598c3d84a85b07428293a61f1502`, verified against genuine Git commit `27433bfc69a236d2fef19ddb6241c88b9c81a897`. Current 0068 was later edited; recorded forward repair `0070_reconcile_ballet_cancellation_schema` explicitly reconciles that historical version. This checksum difference does not affect the 13-row count difference. All 124 recorded identities/timestamps are accounted for: 123 match current files, plus this one verified historical version. All 137 historical candidate SQL files match immutable remote baseline `2b3ab9f5e3568f90ee468707a19992f7b229fb2c`; no old migration rewrite is proposed. Missing rows alone are not a full schema audit or proof that corresponding schema is absent.

**Actual runner-selected pending set: `0137_promotion_admin_operations` only.** Installed Drizzle 0.45.2 reads the highest recorded `created_at` once and selects journal entries with a later timestamp. Recorded watermark is exact 0136 at `1791676800001` (hash `8497227f20e36d3782fa7d8a93def8816f281c8ac63caccc74582391d415da29`). Only 0137 is later: `1792670400000`, hash `6e5de3ca6823db24b7265a713894191722fe7d8acedb4171a2423ea54035d921`. No additional Production migration is justified or authorized by this finding.

**Minimal local correction:** the private preflight now accepts either the full current history or exactly the verified 124-entry history, with precisely those 13 omissions and the independently verified 0068 variant. It requires all remaining hashes/timestamps and recorded repairs, rejects unknown/partial/duplicate history or additional pending migrations, and computes pending work using the installed runner's semantics. It does not fabricate a complete-prefix PASS. SQL, target, authentication, TLS, read-only scope, bounds and timeouts remain unchanged. No Production ledger, journal, migration, schema or application source was modified.

Local helper files under `/tmp/promotions-mobile-recovery-20261025/`: modified `production-migration-preflight.command`; new `preflight_ledger.py`, `test_preflight_ledger.py`, `ledger_drizzle_disposable.test.cjs`, `run_ledger_db_test.py`, and `reassess_saved_ledger.py`. The prior launcher is retained as `production-migration-preflight.before-ledger-fix.txt`.

**Verification: 45 Python tests and 3 real PostgreSQL/Drizzle tests passed; zero failures/skips/TODO.** Commands from the private evidence directory:

```sh
python3 -m unittest -v test_preflight_output.py test_preflight_launcher.py test_preflight_ledger.py
python3 run_ledger_db_test.py
python3 reassess_saved_ledger.py
```

The newly created Unix-socket-only disposable PostgreSQL 18 cluster seeded the sanitized 124-row ledger and synthetic monetary sentinels. Actual installed Drizzle selected and executed only 0137, preserved all 124 prior ledger rows and monetary sentinels, and repeated execution was a no-op at 125 rows. The disposable cluster was stopped afterward. Tests also reject changed historical SQL, unknown hashes, missing repairs, arbitrary omissions, duplicate/partial history, timestamp tampering and additional pending work. These are test-fixture ledger writes, not Production ledger changes.

Saved raw capture SHA-256: `1694621bbbe0fd27a33f0bd143a41cf93c66dbacbae478e9845436efaad19ba0`. Reparsed capture exactly equals the saved JSON. Private offline result: `/tmp/promotions-mobile-recovery-20261025/production-migration-ledger-assessment.json`, with `identity_verified=true`, `historical_ledger_verified=true`, `ledger_gate_passed=true`, `fresh_production_query=false`, `production_mutations=false`. Original failed-prefix summary is preserved. Logs: `ledger-combined-unit-tests.log`, `ledger-drizzle-disposable-tests.log`.

**Pre-deploy behavior reviewed:** both candidate and deployed source `5074d0171103351b45e4fca8c46e375355d7e022` configure Railway `preDeployCommand = "node artifacts/api-server/dist/migrate.mjs"`. The API runner uses the reviewed root migration directory and Drizzle ledger, applying all timestamp-selected pending work. Worker mode exits before opening a migration connection. API/Worker startup does not separately migrate. With this exact candidate and captured watermark, managed pre-deploy selects only approved 0137. Trigger holds, writer pause and remaining release checks still apply; provider settings were not changed or queried during this investigation.

| Release component/gate | Current status |
|---|---|
| Backend | Existing deployment `6d326ef5-1009-4c18-9ef8-1efa5dbd076c`; **no Promotions deployment** |
| Worker | Existing deployment `4c9c49b7-60db-4cfb-a92d-2859bc48122a`; **not redeployed** |
| Admin | Existing Vercel `dpl_CgiHjkeb1stLvrgmEXZJduKxzEaG`; **not redeployed/promoted** |
| Git push/merge and deployment triggers | **Held before push**; no trigger configuration changed. Vercel Git deployment creation is enabled, so provider holds must be applied/verified before any source push. |
| Production migration ledger / 0137 | **PASS from saved read-only evidence and corrected offline assessment; only 0137 pending; migration NOT EXECUTED** |
| Writer pause/drain | Not started; existing live services remain available |
| Test Promotion 3 / codes 2,3,6,7 | **No deletion or deactivation**; approved guarded cleanup/fallback remains unchanged |
| iOS / Android rollout | iOS export ready, no OTA; Android native build FINISHED; submission blocked before upload by unavailable Google Play submission credential |
| Zero-payable package/class smoke tests | **NOT RUN**; no synthetic purchases, payments, bookings or redemptions created |
| Mandatory idempotency/revision flags | **No changes**; remain optional in reviewed source. Live post-deploy protocol verification still pending. |

## Decision and continuation

**Mobile implementation recovery: verified. Production activation: NO-GO until the remaining execution gates pass.** The migration-ledger gate is cleared without another private execution. The previously approved release can resume unchanged in scope, with 0137 as its only selected migration. Android build completion is verified; Android distribution is blocked by the unavailable submission credential. Deployment ordering, writer coordination and actual device/financial smoke verification remain outstanding; their current completion is not claimed by this ledger investigation.

Continue the already approved consolidated release under its remaining safeguards: hold automatic deployment triggers; controlled push/PR/merge; coordinated writer pause; managed API pre-deploy migration **0137 only**; guarded exact test cleanup or audited deactivation; complete compatible API/Worker rollout; Admin; verified iOS OTA and independent Android native distribution; bounded zero-payable financial/audit smoke tests. Do not enable mandatory enforcement or resume mixed-version writers. Existing history-preserving rollback requirements remain binding.

Evidence: `/tmp/promotions-mobile-recovery-20261025/` (directory mode 0700), including `recovery-and-bundle-integrity.json`, `limits-preservation.json`, `native-config-comparison.json`, focused/full test and build logs, `verified-backup-status.json`, and Android metadata. Existing release instructions were corrected for the recovered iOS runtime override and independent Android path; no additional implementation phase was introduced.

Local recovery/integration commits were created; the existing backup service was redeployed and its approved backup job ran; one Android cloud build was started. **No source push/remote merge, Production schema or business-data mutation, migration, test-data cleanup, Backend/Worker/Admin rollout, OTA publication, credential/role/network change or enforcement activation occurred.** Existing release approval remains valid. The ledger blocker no longer requires Owner action or additional migration approval. No further general release authorization is requested. This focused investigation performed no new Production query, push, migration or deployment.
