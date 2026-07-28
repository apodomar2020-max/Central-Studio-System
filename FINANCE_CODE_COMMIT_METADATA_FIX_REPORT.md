# Finance Code Commit Metadata Fix Report

## Starting production commit

`58235475041523b7fa8447f63a1f84ccf35dd083`

## Root cause of `codeCommit: unknown`

Railway supplies the deployed source revision through `RAILWAY_GIT_COMMIT_SHA`. The API `/version` route and Worker reminder heartbeat already read that variable independently, but the Finance dry-run report used a third resolver that checked only `GIT_COMMIT_SHA` and then ran `git rev-parse HEAD`.

Production runtime images do not need to contain Git history. When `GIT_COMMIT_SHA` was absent and no runtime `.git` directory was available, the Finance resolver returned the literal `unknown`, even though Railway had provided the real commit through its canonical variable.

## Previous resolution behavior

- Finance dry-run report: `GIT_COMMIT_SHA` → runtime `git rev-parse HEAD` → `unknown`.
- API `/version`: `RAILWAY_GIT_COMMIT_SHA` → `VERCEL_GIT_COMMIT_SHA` → `unknown`.
- Worker heartbeat: `RAILWAY_GIT_COMMIT_SHA` → `VERCEL_GIT_COMMIT_SHA` → `null`.

These paths validated neither SHA shape nor whitespace and could disagree.

The existing `/api/version` response keeps its `commit` field and now also
returns the same value as `codeCommit`, providing a backward-compatible live
diagnostic for Finance metadata verification.

## Final canonical priority order

All three paths now call `resolveCodeCommit()` from one backend module:

1. `GIT_COMMIT_SHA` — existing explicit application/CI override.
2. `RAILWAY_GIT_COMMIT_SHA` — Railway deployed source revision.
3. `GITHUB_SHA` — standard GitHub Actions revision.
4. `CI_COMMIT_SHA` — standard GitLab CI revision.
5. `VERCEL_GIT_COMMIT_SHA` — Vercel deployment/build revision.
6. Local `git rev-parse HEAD`, only outside detected deployed environments.
7. `local` when local Git metadata is unavailable.
8. `unavailable` for an unsupported deployed environment with no valid metadata.

Commit metadata is trimmed, normalized to lowercase, bounded to a plausible 7–40 character hexadecimal Git SHA, and never throws when absent. Invalid values are ignored and never copied into reports.

## Railway variable used

`RAILWAY_GIT_COMMIT_SHA`

Read-only inspection confirmed that both current API and Worker deployments identify the production revision in Railway deployment metadata and that the live `/api/version` endpoint returns the same full SHA. No unrelated Railway variables or secrets were printed.

## Vercel behavior

The Admin application does not currently display or require `codeCommit`, so no browser bundle or Admin metadata surface was added. The shared backend resolver recognizes the already-used canonical `VERCEL_GIT_COMMIT_SHA` if backend code is ever run in a Vercel context. No server-only value is injected into the Admin client.

## Local and test fallback behavior

Local development may use a validated local Git SHA. If Git metadata is unavailable, the explicit result is `local`. Tests can inject environment and local-reader inputs deterministically. Production/CI-like environments never invoke Git and return `unavailable` when none of the allowlisted variables contains a valid SHA.

## Files changed

- `FINANCE_CODE_COMMIT_METADATA_FIX_REPORT.md`
- `artifacts/api-server/src/lib/codeCommit.ts`
- `artifacts/api-server/src/lib/codeCommit.test.ts`
- `artifacts/api-server/src/lib/financeBackfillDryRun.ts`
- `artifacts/api-server/src/lib/financeBackfillDryRun.test.ts`
- `artifacts/api-server/src/routes/version.ts`
- `artifacts/api-server/src/worker.ts`

No Admin or Central mobile source file changed.

## Tests

- Canonical resolver: Railway, explicit override, GitHub CI, Vercel, whitespace, uppercase normalization, short SHA, invalid data, local Git, local fallback, deployed fallback, no runtime Git in production, and no environment dump.
- Cross-path consistency: Finance report, API diagnostics, and Worker import the same resolver.
- Real disposable-database Finance dry-run report includes the normalized resolved commit.
- Existing Finance evidence, dry-run CLI, production dry-run CLI, and execution CLI metadata/safety suites remain unchanged.

Feature-state verification passed 169 assertions with zero failures and zero skips:

- 125 resolver, cross-path consistency, Finance evidence, dry-run CLI, production dry-run CLI, and execution CLI assertions.
- 44 real Finance dry-run planner/report assertions against a disposable database.

## Typecheck and build results

- `pnpm install --frozen-lockfile`: passed.
- Library typecheck: passed.
- API and Worker production build: passed.
- Admin typecheck/build: passed without Admin source changes.
- Native browser alert scan: passed across 134 Central files.
- Starting production API baseline: 121 known repository-wide errors.
- Feature-state API count: 121 known repository-wide errors.
- Errors in changed files: zero.
- New errors relative to baseline: zero.

## Production verification plan

After a clean `--no-ff` release merge and normal push:

1. Confirm Railway API and Worker deployments both reference final `origin/main`.
2. Confirm both deployments reach `SUCCESS`.
3. Query the live `/api/version` diagnostic endpoint.
4. Require its `codeCommit` value to equal final deployed `origin/main`.
5. Confirm API health and Vercel Admin health.

Production verification is not considered passed on `local`, `unavailable`, or any mismatched SHA.

## Rollback plan

Revert the release merge and redeploy the preceding production commit. No migration or data rollback is required.

## Remaining metadata limitations

The Admin browser has no code-version display, by design. Unsupported production platforms must provide one of the allowlisted commit variables or explicitly configure `GIT_COMMIT_SHA`; otherwise diagnostics report `unavailable` rather than guessing or reading production Git history.
