# Central Studio — Children & Ballet Limits Implementation

## Outcome

**CHILDREN & BALLET LIMITS — BLOCKED**

Backend implementation and focused verification are complete. Mobile implementation is blocked at source preparation: the approved Build 13 commit `b877765d683a549b6296732d9b2b7246e5a824f5` is not in the primary repository's object database. The frozen source directory still exists, but its `.git` file points to the missing `/Users/abdelrahmanomar/Downloads/Central-Studio-Build12-OTP-Fix/.git/worktrees/Central-Studio-Build13-QA-Fixes` metadata. No alternate matching remote branch was found. The frozen directory was not repaired, copied into an invented lineage, or edited.

The owner was asked for a recoverable Git checkout/bundle containing the approved commit. No replacement mobile baseline was assumed. This follows the authorization's requirement to stop an affected stage when significant unexpected source evidence emerges. Backend work continued independently.

## 1. Source and local commits

- Backend baseline: `2b3ab9f5e3568f90ee468707a19992f7b229fb2c` (`origin/main`). Relevant routes were previously verified against running Production artifacts; no Production investigation was restarted.
- Backend branch: `codex/children-ballet-limits-api`.
- Backend implementation commit: `d05cc75` (`feat(api): enforce child and Ballet account capacities`).
- Worktree: `/Users/abdelrahmanomar/.codex/worktrees/children-ballet-limits-api/Central-Studio-System-main`.
- Mobile baseline required: `b877765d683a549b6296732d9b2b7246e5a824f5`; unavailable as a Git object. No mobile implementation branch or commit was created.
- Primary dirty checkout remains untouched, with the same 79 status entries observed before this work. Existing worktrees and release source files were not modified.

## 2. Modified files

- `artifacts/api-server/src/lib/accountCapacity.ts`: fixed policy limits, scoped count queries, structured 422 errors, shared transaction advisory lock.
- `artifacts/api-server/src/routes/children.ts`: atomic limit check, child insertion and completion hint.
- `artifacts/api-server/src/routes/ballet.ts`: shared lock, manual autosave limit, journey admission limit, quota error handling, transaction-scoped assessment read.
- `artifacts/api-server/src/routes/adminBallet.ts`: locked status revalidation before status/level changes.
- `artifacts/api-server/src/lib/accountCapacity.integration.test.ts`: 36 actual PostgreSQL/HTTP integration scenarios.
- `scripts/run-account-capacity-tests.mjs`: creates and destroys a new local PostgreSQL cluster; generates fixture schema from current definitions without executing migrations.
- This implementation report.

## 3. Backend enforcement and concurrency

Standalone profile creation and both linked/manual Ballet admission acquire the same PostgreSQL transaction-scoped advisory lock, namespace `918204`, keyed by verified account ID. Both explicitly use READ COMMITTED isolation. Counts are read after obtaining the lock, and inserts commit in the same transaction.

The four-profile count includes every owned child row. Authentication and the children route's existing student/parent role behavior are unchanged. At four or above, creation receives a structured 422; existing profiles remain viewable/editable.

Ballet capacity counts distinct linked child IDs, or the existing normalized name/birthday legacy key for unlinked records, scoped to the authenticated parent and the five canonical current statuses. Rejected/cancelled/withdrawn history consumes no place. Missing parent associations are never inferred. Linked IDs remain authoritative despite differing application snapshots.

Manual autosave reuses an existing matching profile at four children; only insertion of a new profile invokes the four-profile check. A rejected Ballet admission or failed event insert rolls back a newly auto-saved child, application and events together. The existing duplicate checks, advisory identity lock, and partial unique indexes remain in place; duplicate responses remain 409.

Assessment resolution now accepts the active transaction as an optional query client during admission. Without this adjustment, enough concurrent account-lock waiters could exhaust the pool while the holder requested another connection for assessment validation. The existing callers retain the default client and response behavior.

Cancellation and Worker withdrawal only decrease current capacity. They retain their existing lock ordering, timing and business rules. A submission that reads a still-uncommitted cancellation may safely reject and permit retry after commit. Admin status/assignment writes now re-read and lock the application within the transaction, rejecting stale status changes that could otherwise reopen cancelled records. No Worker source change was needed.

## 4. Limits and legacy verification

The 36 passing focused tests cover:

- Profile counts 0, 1, 3, 4, 5 and 8; fourth-child admission, over-limit rejection, viewing/editing at capacity.
- Preserved student-type child-route behavior, verified ownership, injected parent IDs, anonymous rejection and foreign-child denial.
- Ballet counts 0, 1, 2 and above, including four existing profiles with a remaining Ballet place.
- Every canonical current/terminal application status and same-child reapplication after each terminal outcome.
- Duplicate 409 precedence over quota errors and preserved existing application ID.
- Manual profile reuse at four, fifth-profile rejection, and rollback after a full Ballet account.
- Linked snapshot disagreements, unlinked legacy records and unattributed history without rewriting records.
- Concurrent profile requests, distinct-child Ballet requests, linked/manual duplicate submissions and cross-route profile/autosave races.
- Separate-account progress and a 15-request test exceeding the connection-pool size.
- Deterministically blocked stale Admin status/assignment requests, concurrent cancellation/admission and Worker finalization.
- Failure of the event write rolls back the whole manual submission.
- Existing over-limit journeys remain readable and can progress without allocating another place.

Remaining identity gaps are preserved and explicit: separate profiles for the same real child remain separate IDs; linked/unlinked legacy representations are not automatically merged; name/DOB matching retains existing behavior. Numerical enforcement does not claim universal real-person deduplication.

## 5. API compatibility

New responses are HTTP 422 with `error`, `code`, `limit`, and `currentCount`:

- `CHILD_PROFILE_LIMIT_REACHED`
- `BALLET_CHILD_LIMIT_REACHED`

Existing 201 bodies, 409 duplicate semantics, authentication, authorization and validation are preserved. No generated clients, OpenAPI definitions, or list response shapes were edited. Quota errors are distinct from existing duplicate conflicts, including for older clients that label 409 as Already Applied.

## 6. Mobile stage

**Not implemented or verified.** Recovering the approved Git baseline is required before changes to Profile, Onboarding, assessment, landing eligibility or form-error handling. No mobile visibility, stale-state, account-switch, native-compatibility or regression PASS is claimed for this implementation.

Once the exact commit is recoverable, continue in a separate isolated branch, preserve native configuration and apply the previously approved mobile plan. Additional implementation permission is not needed for that already-approved scope; the missing source provenance is the blocker.

## 7. Verification results

| Check | Result |
|---|---|
| New real PostgreSQL/HTTP integration suite | 36/36 PASS |
| Relevant existing source/model regression tests | 74/74 PASS |
| API build | PASS |
| Shared library TypeScript build | PASS |
| API TypeScript | 167 inherited diagnostics; pristine baseline has the same 167 with identical file/error-code multiplicities; no added diagnostics in new code |
| Existing broader cancellation route suite | 39/39 blocked by setup fixture violating `students_phone_canonical_check`; reproduced unchanged against pristine baseline |
| Migration/schema/generated-client diff | Empty |
| Diff whitespace check | PASS |
| Mobile suites | NOT RUN — baseline recovery required |
| Entire monorepo suite | Not claimed; focused and broader results above are reported separately |

Repeat focused integration tests with:

```sh
node scripts/run-account-capacity-tests.mjs
```

The harness ignores ambient database connection targets, initializes a new cluster, binds localhost, creates a new database, exports current schema into that database, runs tests, stops PostgreSQL and removes only its generated temporary directory. It does not execute historical migrations. Separate requests use actual pooled PostgreSQL connections. Redis and push are disabled for the fixture environment.

## 8. Database, Admin and Worker impact

No schema changes, migration SQL/journal changes, timestamp repairs, ledger rewrites, new uniqueness rules or data cleanup were introduced. Historical migration exceptions remain untouched.

Admin status and assignment transactions gain stale-state protection only. Existing financial, activation, assignment, subscription, package-credit and cancellation semantics remain authoritative. The actual Worker withdrawal implementation was exercised using synthetic records and permits new admission only after application status changes to withdrawn.

The candidate migration journal is byte-identical to the verified baseline. Its greatest timestamp remains `1791676800001`, equal to the latest previously verified Production ledger maximum. It therefore selects zero migration bodies under the verified runner. Release readiness is not declared: the exact final combined release candidate must repeat the read-only preflight against the then-current ledger.

## 9. Remaining risks and release sequence

1. Recover the approved mobile commit and complete that stage; do not substitute the dirty SDK-upgrade branch or modify the frozen release directory.
2. Retain the inherited TypeScript/cancellation-fixture failures as separately tracked issues; do not silently claim a green full suite.
3. Recheck the exact release candidate, installed uniqueness constraints, writer inventory and zero selected migration bodies before deployment authorization.
4. Deploy all API writers coherently. An older API instance can bypass the new advisory-lock/admission protocol. Verify Worker lifecycle compatibility; its current terminal-only writes do not create places.
5. Release the verified compatible mobile update afterward. Older clients can receive backend quota errors but may continue to show stale creation actions.
6. Preserve data on rollback. Prefer a corrective backend release; reverting numerical enforcement requires an owner decision. No database rollback is required by this implementation.

No release action is authorized or was performed. No Production connection, Production write, Railway change, Git push, EAS build, OTA publication or TestFlight upload occurred during local implementation.

## 10. Final status

Backend implementation is preserved in a focused local commit. The implementation worktree is clean after the report commit. Overall outcome remains **CHILDREN & BALLET LIMITS — BLOCKED**, solely pending recovery and completion of the approved mobile lineage, with inherited verification failures explicitly documented.
