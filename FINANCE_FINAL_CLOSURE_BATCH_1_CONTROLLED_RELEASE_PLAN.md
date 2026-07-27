# Finance Final Closure Batch 1 — Controlled Release Plan

**This document is an investigation-based plan only. No merge, push, deploy, or migration was performed in the preparation of this plan or any prior task in this sequence.**

## 1. Final Feature Branch Head After the Documentation Correction

- Branch: `feat/finance-final-closure-batch-1`
- Final branch head (after the release-head correction commit): `551069a0a81142fa454c4e106fcd8c11a819e287` (`551069a`)
- Final independently reviewed runtime head (no runtime/test/migration change since): `35b3f7cd4b3a18c7f2e71a32ecf873dd8b688ae3` (`35b3f7c`)
- All commits after `35b3f7c` (`11acb84`, `36d6252`, `551069a`, and this plan's own commit) are documentation-only.

## 2. Latest `origin/main`

- `origin/main` = `d5ab3bd017392459a2e5cbb0dfd58af7e7ea0e4f` — **byte-identical to this batch's baseline.** `git fetch origin --prune` followed by `git diff d5ab3bd..origin/main --stat` produced **zero output** — `origin/main` has not moved at all since this branch was created.

## 3. Conflict Assessment

**NO CONFLICTING UPSTREAM CHANGES.**

Because `origin/main` is byte-identical to the baseline (`d5ab3bd`) this branch was built from, there is no upstream history to conflict with — a `git diff` between the two shows nothing, which is conclusive proof: any two-way merge of this branch into `origin/main` is exactly equivalent to merging it into the original baseline this branch already re-verified against in every prior task in this sequence. This was confirmed by direct `git diff --stat` comparison rather than a disposable-worktree merge dry run, since an empty diff is a stronger and simpler proof than a merge trial would add (a merge test only becomes informative once the two histories actually diverge). The specific files named for this check —
`artifacts/api-server/src/routes/bookings.ts`, `myRoutes.ts`, `students.ts`, `artifacts/api-server/src/lib/financeSources.ts`, `financeReadModel.ts`, `artifacts/admin/src/components/unified-attendance-dialog.tsx`, `artifacts/central/contexts/AppContext.tsx`, `artifacts/central/app/booking/flow.tsx`, `artifacts/central/tsconfig.json`, `lib/db/src/schema/bookings.ts`, `lib/db/migrations/meta/_journal.json`
— are all unchanged on `origin/main` relative to the baseline, trivially, since nothing on `origin/main` changed at all.

If this plan is executed after further time has passed and `origin/main` has since moved, **re-run `git fetch origin --prune && git diff d5ab3bd..origin/main --stat` (or the new `origin/main` SHA) and re-check the file list above before merging** — this conclusion is only valid as of the SHA recorded in §2.

## 4. Deployment Trigger Table

Investigated from `railway.toml`, `artifacts/admin/vercel.json`, `DEPLOY.md`, `eas.json`/`artifacts/central/eas.json`, and `artifacts/api-server/scripts/railway-start.mjs`. No `.github/workflows` directory exists in this repository — there is no GitHub Actions-based CI/CD; deployment automation is entirely platform-native (Railway/Vercel git integration) plus manual EAS commands for mobile.

| Component | Trigger | Automatic on `main` push? | Required ordering | Evidence |
|---|---|---|---|---|
| **Database Migration 0085** | Railway's `preDeployCommand` (`node artifacts/api-server/dist/migrate.mjs`), run as part of the **API service's** Railway build/deploy pipeline | **Yes — automatically, as a side effect of the API's auto-deploy.** There is no separate manual "apply migration" step in this repo's normal flow; pushing to `main` both builds and migrates in one pipeline. | Runs **before** the new API deployment starts serving traffic; if migration fails, the deploy aborts and the previous deployment keeps serving (per `DEPLOY.md`'s "Database schema changes" section) — a real safety net, but it means **the migration is not a separately-gated manual step once code is pushed to `main`.** | `railway.toml`: `preDeployCommand = "node artifacts/api-server/dist/migrate.mjs"`; `DEPLOY.md` §"Database schema changes": "Railway builds, then runs the pre-deploy step... Success → the new deployment starts serving. Failure → the deploy is aborted." |
| **API (`api-server`)** | Railway git integration watching the connected branch (per `DEPLOY.md`, this is set up against the GitHub repo at Railway project creation) | **Yes.** `DEPLOY.md`: "Click **Deploy** (or push to main — Railway auto-deploys on every push)." and, in the redeploy table, "API server code → `git push` — Railway auto-redeploys." | Deploys atomically with the Migration 0085 pre-deploy step above (same pipeline, same service) — cannot be separated once triggered. | `DEPLOY.md` §1.4, §"Redeploying after code changes". |
| **Admin** | Vercel git integration | **Yes.** `DEPLOY.md` redeploy table: "Admin dashboard code → `git push` — Vercel auto-redeploys." | Independent pipeline from Railway; not sequenced with the API deploy by any mechanism in this repo — both fire on the same push, in parallel, from Vercel's and Railway's own independent webhooks. | `artifacts/admin/vercel.json` (build/install commands); `DEPLOY.md` §2, §"Redeploying after code changes". |
| **Worker** | Railway git integration — **same `railway.toml`, a separate Railway *service*** distinguished by the `QUEUE_WORKER_ENABLED` environment variable | **Yes**, same automatic trigger as API (same repo push, Railway watches every connected service on that branch). | The migrate script is a no-op for this service — `railway-start.mjs` explicitly checks `QUEUE_WORKER_ENABLED === "true"` and runs `worker.mjs` instead of the API entrypoint; `DEPLOY.md` confirms "the migrate script exits immediately when `QUEUE_WORKER_ENABLED=true` — only the API service applies migrations, so two services never race on the same schema change." No ordering action needed beyond confirming this env var is set correctly on the worker service (out of scope to verify from this repo checkout — a Railway dashboard setting). | `railway.toml` comment: "the migrate script exits 0 immediately when QUEUE_WORKER_ENABLED=true, so only the API service actually applies migrations"; `artifacts/api-server/scripts/railway-start.mjs`: `const isWorker = process.env.QUEUE_WORKER_ENABLED === "true";`. |
| **Central Mobile** | **Manual EAS command only** (`eas build --profile preview/production --platform android/ios`, then `eas submit`/manual distribution) | **No.** Nothing in this repo auto-triggers a mobile build or store submission on a `main` push. | Entirely decoupled in time from the API/Admin/Worker deploys — must be run explicitly, after API/Admin are live and verified, per the existing approved mobile release process this team already uses. | `DEPLOY.md` §3 (manual `eas build`/`eas init`/`eas secret:create` steps); redeploy table: "Mobile app code → `eas build --profile preview --platform android` again" (an explicit re-run, not automatic); `eas.json`/`artifacts/central/eas.json` define build profiles only, no CI trigger. |

**Key implication for release ordering**: because API, Admin, and Worker all auto-deploy the instant `main` is pushed to — and the Migration 0085 pre-deploy step is *inside* that same automatic API pipeline — there is no window to "apply the migration, then separately push code" as two operator-controlled steps. The only pre-push manual gate available is the production duplicate-diagnostic query (§5 below), which must run **before** the push, since after the push the migration will already be attempting to apply itself automatically.

## 5. Exact Safe Ordering

1. **Production duplicate diagnostic query** — run manually against the production database, **before** any merge/push, using read-only access:
   ```sql
   select schedule_id, occurrence_date, account_owner_student_id, coalesce(participant_child_id, 0) as pcid, count(*)
   from bookings
   where occurrence_date is not null and account_owner_student_id is not null and booking_status in ('pending','confirmed')
   group by 1,2,3,4 having count(*) > 1;
   ```
   - **Stop condition**: any returned row means real active double-bookings exist in production. Do not proceed — this must be resolved (product/ops decision on the conflicting live bookings) before Migration 0085 can be safely applied, since the automatic pre-deploy migration step would otherwise fail and abort the API deploy (safe, but disruptive and to be avoided by checking first).
2. **Migration 0085** — not a separate manual step in this repo's normal flow; it runs automatically as part of the API's Railway `preDeployCommand` the moment the merged code reaches the connected branch (see §4). There is no "apply migration, wait, confirm, then push code" sequence available — treat step 1 as the actual gate, and steps 3+ as the trigger for both migration and code deploy together.
3. **Merge/push to `main`** — merge `feat/finance-final-closure-batch-1` (final head `551069a`, on top of the independently reviewed runtime head `35b3f7c`) into `main` and push, per the team's normal PR/merge process. This single push automatically triggers API+Migration 0085 (Railway), Admin (Vercel), and Worker (Railway) simultaneously.
   - **Stop condition**: if `origin/main` has moved since §2's SHA was recorded, re-run the conflict check in §3 first and abort this step if any of the 11 named files show a real upstream change requiring re-review.
4. **API deploy** — automatic, part of step 3 (Railway). Confirm via Railway deploy logs: `✓ pnpm install`, `✓ pnpm --filter @workspace/api-server run build`, `✓ [pre-deploy] [migrate] Migrations complete.`, `✓ Server listening on port ...` (per `DEPLOY.md` §1.4).
   - **Stop condition**: if the migration step fails, the deploy aborts automatically and the previous deployment keeps serving (Railway's built-in behavior) — no manual rollback action is needed for this specific failure mode, but investigate before pushing again.
5. **Admin deploy** — automatic, part of step 3 (Vercel), independent of the API deploy's timing. Confirm by opening the Vercel URL and checking the dashboard loads and can reach the API (`DEPLOY.md` §2.4 verification steps).
6. **Worker decision** — no action required beyond confirming (via the Railway dashboard, outside this repo checkout) that the worker service's `QUEUE_WORKER_ENABLED` variable is still set correctly so it continues to skip the migration step and only runs `worker.mjs`. This batch introduced no worker-specific code changes.
7. **Central mobile release** — **manual, separate, later step.** Only after steps 4–5 are confirmed healthy: run the existing approved mobile release process (`eas build --profile production --platform android/ios` then the team's existing submission path), per `DEPLOY.md` §3. This is not triggered by the `main` push and has no fixed time relationship to it — schedule it deliberately.

## 6. Stop Conditions (Consolidated)

- Production duplicate-diagnostic query (step 1) returns any row → **do not merge/push.**
- `origin/main` has diverged from the SHA recorded in §2, and any of the 11 named files show a real change → **re-review required before merging**, not a blanket go-ahead.
- Railway deploy logs do not show `Migrations complete.` and a healthy `/api/healthz` → **do not proceed to mobile release**; the automatic rollback (previous deployment keeps serving) already protects production, but investigate before re-pushing.
- Any of the required production smoke tests (§7) fail → **halt before Central mobile release**, and consider the rollback plan (§9).

## 7. Required Production Smoke Tests

(Unchanged from `FINANCE_FINAL_CLOSURE_BATCH_1_RELEASE_READINESS.md` §5 — restated here for a single-document release checklist.)
- Create a package order, activate it with Cash, confirm Finance Packages shows a real Status/Method/Amount (not blank, not "Service Credit Unit" mislabeled as payment status).
- Confirm a parent with two active packages (e.g. 3 + 4 credits) sees **7** on the Admin Parent profile, Mobile Profile, and Credit History screens consistently.
- Scan/search a parent with exactly one real booking via the Admin Attendance Gateway — confirm only that participant is labeled "Booked for this class," and any other family member offered is clearly labeled "Available as Walk-in," not the same green label.
- Confirm a Pay-at-Studio booking: after Admin confirms payment, the booking simultaneously shows Paid and Confirmed (no lingering Confirm/Reject buttons).
- Attempt to double-book the same participant for the same class occurrence from the mobile app — confirm the already-booked participant is shown disabled with "Already booked," not merely rejected after submission.
- Fire two genuinely concurrent booking requests for the same participant/occurrence against the deployed API — confirm exactly one succeeds (201) and the other returns 409 `duplicate_booking`, never a 500.

## 8. Tuesday/Thursday UAT

**Open UAT item — Tuesday/Thursday paid-state bleed was not reproduced automatically and must be verified on the deployed mobile flow before final feature closure.**

Perform this on the released mobile build (post step 7 above): book and pay for one occurrence of a twice-weekly recurring class, let it pass, and confirm the next occurrence independently shows its own correct pending/unpaid state on every relevant screen — not "Paid" carried over. This is required regardless of how clean the smoke tests above are, since it was never observed on a running mobile app in any prior task in this sequence.

## 9. Rollback Order

1. **Central mobile** (if released and implicated): roll back via the existing approved mobile release process's own mechanism (OTA revert or store rollback) — independent of, and not blocked by, the steps below.
2. **API + Admin**: revert the single merge commit that brought this branch into `main`, then push — Railway and Vercel will auto-redeploy the reverted state, exactly mirroring how they auto-deployed the forward change.
3. **Migration 0085**: `DROP INDEX "bookings_active_occurrence_participant_unique";` — safe, reversible, no data loss (the index carries no data of its own). Run this manually against the production database; it is not automatically reverted by the code rollback in step 2, since Railway's pre-deploy step only ever adds/applies forward migrations, never rolls one back automatically.
4. **Worker**: no explicit rollback action beyond redeploying alongside step 2 (same repo state, same automatic trigger) — this batch made no worker-specific changes.

Rollback order is mobile → API/Admin → migration, because a stale mobile client is the most user-visible and the fastest to individually revert; the migration is deliberately rolled back last since dropping the index has no effect on the reverted application code's correctness (the code released before this batch never referenced the index at all).

## 10. Explicit Statement

**This task performed no merge, push, deploy, or migration.** `origin/main` remains at `d5ab3bd017392459a2e5cbb0dfd58af7e7ea0e4f`, unchanged. The feature branch `feat/finance-final-closure-batch-1` remains unmerged at head `551069a` (plus this plan's own documentation commit). Migration 0085 remains unapplied to any staging or production database. No Railway, Vercel, or EAS action was triggered. All investigation in this document was performed by reading repository configuration and documentation files (`railway.toml`, `artifacts/admin/vercel.json`, `DEPLOY.md`, `eas.json`, `artifacts/api-server/scripts/railway-start.mjs`) and comparing git history — nothing in this task queried or altered any live deployment platform or production database.
