# FINAL PRODUCTION VERIFICATION REPORT — PROMOTIONS

2026-10-25. **PARTIAL execution; Production activation NO-GO pending the private database preflight and remaining rollout gates. The Build 13 source/runtime blocker is resolved.** Existing release authorization remains valid; no new general release approval is requested.

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

**Android:** latest existing build `2192c13f-e5e1-4621-9aef-ecb18eeb84c9` is an SDK 54 internal preview, runtime `1.0.0`, preview channel. Matching runtime text does not make it compatible with SDK 57. The store-build query returned no existing Android store build. One necessary SDK 57 native candidate was started from verified Mobile commit `ccb3fcc`, with existing Production profile/signing, `--freeze-credentials`, no automatic submission: **`4ad3046d-f9d0-42d6-9698-776de647bcf3`**. Last observed status: **IN_PROGRESS**, Production channel, STORE distribution, runtime `1.0.0`, versionCode 1. No Android OTA was published, no credential changes made, and no store/device acceptance claimed. Available local space was **6.3 GiB** before starting the cloud build; no local native compilation was attempted.

## Actual Production actions and current gates

1. Redeployed the **existing encrypted backup service only**, preserving its existing source/configuration/schedule: deployment **`4ca69243-cccd-4d98-afeb-943f3f39c408`**, image `sha256:4e26d0d3a41ea16a60dd8a88df7038344b60d809fbbcd97f67b91f57eff8cf90`. Redeployment alone was not counted as a backup.
2. Triggered one on-demand run using the existing cron mechanism: run **`0619c7c8-0e7c-4311-af17-659a2f8bc332`**, exited 2026-10-25 **11:28:49 UTC**. Sanitized structured log confirms **backup_status=success**, dump 741,553 bytes, encrypted file 741,929 bytes, remote integrity verification complete. Encrypted checksum: `06f20389245af38b6f9ed36f8477c4a81eb76c63087dbfaf91eaf859ddb1a7f4`. Existing retention policy reported `kept:10,deleted:1`; it was not changed. The job validates archive structure with `pg_restore --list`; no fresh decryption/restore rehearsal is claimed. Owner separately confirmed the existing recovery key is available privately.
3. Verified the existing registered Railway SSH key and exact Production PostgreSQL service/instance transport. Read only public certificate paths/metadata: existing CA validates server certificate, subject/SAN `localhost`, valid through September 5, 2028. No keys, credentials, roles, networking or certificates were created/changed. This authenticated service-bound transport supports service-local `verify-full`; no TCP hostname-verification downgrade was made.
4. Read aggregate monitoring: last-hour API **5 requests, 0 4xx/5xx**, database average approximately **0.00035 vCPU**, memory approximately **91 MiB** at the recorded check. No customer-level log/data output.

**Pending private authentication:** browser Console input proved unreliable, so no SQL was attempted through it. A private Terminal launcher now uses the same existing registered service SSH transport and service-local verified TLS. It explicitly unsets password/service-file sources, requires a hidden manual password prompt outside Codex, and executes only bounded `REPEATABLE READ READ ONLY` identity/TLS/migration-ledger SELECTs. It compares every recorded migration hash/timestamp with immutable candidate `b0e2a4f` and requires **0137 only** to be pending. No preflight result has yet been generated; the ledger gate is not passed by assumption.

Owner's exact pending action in macOS Terminal:

```sh
/tmp/promotions-mobile-recovery-20261025/production-migration-preflight.command
```

Enter the existing administrator password only at that private prompt; never in Codex/chat. Result files are private under `/tmp/promotions-mobile-recovery-20261025/`. The script stops on authentication, TLS, target, timeout or ledger mismatch and never retries automatically. It cannot apply a migration or clean data.

| Release component/gate | Current status |
|---|---|
| Backend | Existing deployment `6d326ef5-1009-4c18-9ef8-1efa5dbd076c`; **no Promotions deployment** |
| Worker | Existing deployment `4c9c49b7-60db-4cfb-a92d-2859bc48122a`; **not redeployed** |
| Admin | Existing Vercel `dpl_CgiHjkeb1stLvrgmEXZJduKxzEaG`; **not redeployed/promoted** |
| Git push/merge and deployment triggers | **Held before push**; no trigger configuration changed. Vercel Git deployment creation is enabled, so provider holds must be applied/verified before any source push. |
| Production migration ledger / 0137 | **Private preflight pending; migration NOT EXECUTED** |
| Writer pause/drain | Not started; existing live services remain available |
| Test Promotion 3 / codes 2,3,6,7 | **No deletion or deactivation**; approved guarded cleanup/fallback remains unchanged |
| iOS / Android rollout | iOS export ready, no OTA; Android native build in progress, no submission |
| Zero-payable package/class smoke tests | **NOT RUN**; no synthetic purchases, payments, bookings or redemptions created |
| Mandatory idempotency/revision flags | **No changes**; remain optional in reviewed source. Live post-deploy protocol verification still pending. |

## Decision and continuation

**Mobile implementation recovery: verified. Production activation: NO-GO until the remaining execution gates pass.** The next blocker is the required private database authentication/preflight, not missing Mobile source and not a new business-policy approval. Android build completion/distribution and actual device/financial smoke verification also remain outstanding.

After the private preflight passes, continue the already approved consolidated release: hold automatic deployment triggers; controlled push/PR/merge; coordinated writer pause; managed API pre-deploy migration **0137 only**; guarded exact test cleanup or audited deactivation; complete compatible API/Worker rollout; Admin; verified iOS OTA and independent Android native distribution; bounded zero-payable financial/audit smoke tests. Do not enable mandatory enforcement or resume mixed-version writers. Existing history-preserving rollback requirements remain binding.

Evidence: `/tmp/promotions-mobile-recovery-20261025/` (directory mode 0700), including `recovery-and-bundle-integrity.json`, `limits-preservation.json`, `native-config-comparison.json`, focused/full test and build logs, `verified-backup-status.json`, and Android metadata. Existing release instructions were corrected for the recovered iOS runtime override and independent Android path; no additional implementation phase was introduced.

Local recovery/integration commits were created; the existing backup service was redeployed and its approved backup job ran; one Android cloud build was started. **No source push/remote merge, Production schema or business-data mutation, migration, test-data cleanup, Backend/Worker/Admin rollout, OTA publication, credential/role/network change or enforcement activation occurred.** Existing release approval remains valid. Resume after the private operator preflight; no further general release authorization is requested.
