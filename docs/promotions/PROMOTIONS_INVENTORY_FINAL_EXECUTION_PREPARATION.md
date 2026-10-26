# Promotions inventory — final execution preparation

2026-10-25. Local implementation and disposable testing only.

## Verdict

**BLOCKED for Console-only execution. The single recommended alternative is implemented and passes local verification, but its Production use awaits explicit Owner approval.**

The browser Console is a service-container shell, not a mechanism for attaching the Mac's Node process to an existing SQL session. The official `postgres-ssl` PostgreSQL 18 Dockerfile uses the PostgreSQL image and installs PostgreSQL tools, OpenSSL and related utilities; it does not install Node.js, tsx or this uncommitted repository. Its current published source is evidence about the supported image, not an inspection of this deployment's exact running filesystem/digest. No Production runtime was assumed or inspected. No Console equivalent was established without installing/transferring a runtime or replacing the validated classification logic. Neither approach was pursued.

**Recommended alternative:** run the existing TypeScript inventory locally on the Owner's Mac, through the already-enabled `acela.proxy.rlwy.net:54187` route, using the independently service-bound root/server certificates, exact server-certificate pinning plus CA verification, and a private administrator-password prompt. Inside that one connection, execute only session/catalog metadata until privileges have been dropped to `central_promotions_inventory_ro`. Keep the role NOLOGIN. No Production package, role, grant, certificate, networking, service or schema change is required.

This is a proposed additional transport/authentication procedure, not a claim that permission to use administrator authentication outside the Console was already granted. Earlier restrictions against using administrative credentials as an access workaround remain respected: **do not execute this alternative until the Owner explicitly approves this exact transport/authentication arrangement and the bounded inventory run.** No credentials were read, requested in chat, exported, or used by this task.

## Repository preservation

Isolated worktree: `/Users/abdelrahmanomar/.codex/worktrees/promotions-phase1a/Central-Studio-System-main`.

Branch `codex/promotions-phase1a`; HEAD and read-only `git ls-remote origin refs/heads/main` both `2b3ab9f5e3568f90ee468707a19992f7b229fb2c`. Before editing, 42 existing candidate/report files were hashed. Only the inventory runner and release-runbook note intentionally change among those files. Phase 1A/1B/1C application logic, Admin/Mobile corrections, schema, migration 0137 and journal remain unchanged. No work was staged, discarded, committed or moved. The original dirty Downloads checkout was not modified.

## Exact local changes

| File | Purpose |
|---|---|
| `scripts/src/promotionsInventory.ts` | Extract the existing calculation/query body into one shared function, expose an already-connected-client entry point, explicitly set transaction limits/search path and invoke the restricted-session preflight. Original URL CLI remains compatible. |
| `scripts/src/promotionsInventoryAccess.ts` | Fixed five-table column allowlist and metadata-only transport/role/ACL/RLS checks before business reads. |
| `scripts/src/promotionsInventoryPinned.ts` | Mac-only operator CLI: fixed approved endpoint/database/user, CA plus exact leaf pin, private password input, one client, deadline and private atomic report publication. No environment/secret/API lookups. |
| `scripts/src/promotionsInventoryAccess.test.ts` | Permanent real-PostgreSQL/TLS, privilege, output and private-terminal regressions. |
| `docs/promotions/PHASE_1C_RELEASE_RUNBOOK.md` | Link this separately gated procedure; retain every release gate. |
| `docs/promotions/PROMOTIONS_INVENTORY_FINAL_EXECUTION_PREPARATION.md` | This report and future Owner command. |

No dependencies, lockfiles, generated contracts, business policies or migration files were changed.

## Safety protocol

1. Require two explicit CLI approval switches, an interactive private terminal, and the public certificate file paths. Neither switch substitutes for actual Owner approval.
2. Validate that the supplied server certificate is issued/signed by the supplied CA. These files must already be authenticated as belonging to the correct Production PostgreSQL service through the trusted Railway Console/dashboard. Files obtained only from the unauthenticated TCP endpoint are not an acceptable trust source.
3. Prompt for the existing PostgreSQL administrator password without echo. It is not passed through arguments, environment variables, a URL, history or a file. Input has a two-minute cancellation deadline; Ctrl-C/EOF abort. Human input is collected before the five-second connection deadline starts. Authentication is transmitted only after the PostgreSQL TLS handshake succeeds.
4. Open one connection to the fixed endpoint, database `railway`, user `postgres`. Require TLS 1.2 or newer, CA-chain/validity verification (`rejectUnauthorized: true`) and byte-for-byte equality with the independently authenticated server certificate. This deliberately uses a service-bound certificate identity rather than claiming that the external proxy has a matching DNS SAN. It does not set `host=localhost`, use `sslmode=require`, accept arbitrary certificates or disable CA validation. Renewal/rotation causes a pin mismatch and a stop; never refresh the pin automatically.
5. Start `REPEATABLE READ READ ONLY`; explicitly set the 5-second statement, 500ms lock, 15-second idle-transaction limits and `pg_catalog, public` search path. Startup options also default the session to read-only and those same timeouts.
6. Before role switching, use only same-session metadata to verify database identity, original authenticated `postgres` actor, TLS and protocol. Disposable testing demonstrated that `pg_stat_ssl` can return no rows after switching to a NOLOGIN role authenticated through another actor. No monitoring grant was added to bypass this restriction.
7. `SET LOCAL ROLE central_promotions_inventory_ro`. Verify effective role, database, read-only/isolation/timeouts, NOLOGIN/NOINHERIT and all administrative attributes disabled; zero memberships; exact required columns accessible; no extra business-column SELECT or table/column write/sequence privileges or relation ownership; public schema USAGE; approved relations are ordinary tables with no RLS. Metadata result rows are capped at 100,000. These checks are fail-closed, not a general-purpose privilege auditor or an untrusted-SQL sandbox. Keep the earlier comprehensive shared-ACL/function/ownership review requirements; this task does not certify uninspected Production ACLs.
8. Run the original eight SELECTs, classification, normalization and reconciliation on the **same connection and snapshot**, with the restricted role effective for every business query. There is no dynamic business SQL or new query for customer records.
9. Validate all bounds and serialized output before read-only COMMIT. On error, roll back and close; emit only the existing sanitized failure message, never server errors/raw SQL/credentials. No automatic retry or limit relaxation.
10. Publish a complete version-2 report locally in a new private home-directory folder (0700), as `inventory.json` (0600), after writing a pending file and renaming it. Terminal success output contains only the private path, not the inventory. A storage failure is not reported as success. A failed pending file, if any, is not a completed report.

The connection/run has a stricter additional two-minute deadline after human input. It closes that one client rather than using a privileged cancellation connection. JavaScript classification remains bounded by the original input/output limits; the deadline is not a preemptive CPU sandbox.

All eight business SELECTs, result construction, classification and bound checks through pre-COMMIT serialization remain byte-identical to the pre-task source. There is no SQL export, substitute normalization algorithm, partial summary, historical repair or runtime-policy change.

## Preserved limits and operational impact

- One database connection; 5-second connection/statement timeouts.
- 500ms lock timeout; 15-second idle-in-transaction timeout.
- 10,000 Promotions; 50,000 codes; 50,000 packages.
- 16 MiB logical rules/code payload.
- 10,000 entries per bounded anomaly/review/package-reference category.
- 4 MiB exact pretty-printed UTF-8 JSON output.
- Fail on overflow; no successful partial report and no automatic retries.

Output remains aggregates plus approved minimal anomaly identifiers/amounts. Raw promotion codes, rules, customer identity/contact data and credentials are not exported. The code and rules remain transient inputs to the original validated local classification logic.

Aggregate scans still touch redemption/payment tables: output limits do not bound scan cost. Before any approved run, select a low-traffic window, use existing authorized database monitoring, define the acceptable load envelope and cancellation responsibility, and note replica lag if applicable. Stop on timeout, contention, unexpected target, pin mismatch, privilege/RLS failure or operational load concern. Do not relax limits or change grants to force a result.

## Verification evidence

New disposable cluster only: `/tmp/promotions-inventory-adapter-20261025/pgdata`, loopback port 55456, database `promotions_inventory_adapter_disposable`. The existing migration chain initialized this newly created synthetic database only. Synthetic CA/server certificates and restricted-role/grant/RLS fixtures were created only there. The cluster is shut down after verification. No existing database or environment was migrated or modified.

Final results:

| Check | Result |
|---|---|
| Existing `promotionsInventory.test.ts` | 31 passed; zero failed/skipped/cancelled/TODO |
| New `promotionsInventoryAccess.test.ts` | 20 passed; zero failed/skipped/cancelled/TODO |
| Total relevant executable tests | **51 passed; zero failures, skips or blocked/TODO** |
| Scripts TypeScript | Exit 0 |
| Database TypeScript | Exit 0 |
| Focused pinned-runner esbuild compile | Exit 0; local compile check, not a portable Production bundle |
| `git diff --check` | Exit 0 |
| Existing inventory body preservation | Byte-identical business queries/calculations/bounds/result section |

Tests execute all eight actual inventory queries with only the approved column-level grants on the five real migrated tables. They assert effective role, read-only, repeatable-read and all timeouts at each query; compare the resulting report exactly with the original runner; confirm snapshots unchanged and raw codes absent; verify role restoration after commit/rollback; and reject wrong database, plaintext transport, missing required grants, extra sensitive/unapproved SELECT, writes, RLS, LOGIN and membership changes before any business query. Real TLS tests cover the matching pin, mismatched pin and untrusted CA. A synthetic pseudo-terminal proves password input is accepted without echo. Output tests verify permissions, atomic final filename and no output directory on a serialized-size failure. CLI rejection tests actually load the runner and confirm sanitized errors with no successful stdout.

The original 31 tests retain the payload/row/anomaly/output ceilings, snapshot-barrier, timeout, lock/error and classification coverage. The 372-test application matrix was not repeated: no application code changed. Its previously verified result and 167 inherited API TypeScript diagnostics are historical baseline evidence, not newly executed checks in this task.

Commands (from the isolated worktree; local disposable variables only):

```sh
DISPOSABLE_PROMOTIONS_INVENTORY_DATABASE_URL=postgresql://postgres@127.0.0.1:55456/promotions_inventory_adapter_disposable \
  lib/db/node_modules/.bin/tsx --test scripts/src/promotionsInventory.test.ts

DISPOSABLE_PROMOTIONS_INVENTORY_DATABASE_URL=postgresql://postgres@127.0.0.1:55456/promotions_inventory_adapter_disposable \
DISPOSABLE_INVENTORY_CA=/tmp/promotions-inventory-adapter-20261025/root.crt \
DISPOSABLE_INVENTORY_LEAF=/tmp/promotions-inventory-adapter-20261025/pgdata/server.crt \
  lib/db/node_modules/.bin/tsx --test scripts/src/promotionsInventoryAccess.test.ts

node node_modules/typescript/bin/tsc -p scripts/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p lib/db/tsconfig.json --noEmit
artifacts/api-server/node_modules/.bin/esbuild scripts/src/promotionsInventoryPinned.ts \
  --bundle --platform=node --format=esm --packages=external \
  --outfile=/tmp/promotions-inventory-adapter-20261025/inventory-pinned.mjs
git diff --check
```

Actual commands used `/opt/homebrew/bin/node` / a PATH including that directory. Logs and source-preservation manifests: `/tmp/promotions-inventory-adapter-20261025/`. Local runtime: Node v25.9.0, node-postgres 8.21.0, PostgreSQL 18.

## Future Owner execution — NOT authorized or executed now

**Approve first:** (a) this exact local, certificate-pinned existing-proxy transport using privately entered PostgreSQL administrator authentication, followed by mandatory restricted-role execution; and (b) one bounded Production inventory run during the agreed monitored window. No approval is assumed from local test success or from enabling the proxy. The privileged connection is retained by the trusted runner and can technically reset its role; this is not a dedicated low-privilege login or a boundary for arbitrary SQL.

Prerequisites: existing approved administrator authentication works through the proxy; the two public certificate files were obtained through authenticated access to this exact service and remain current; comprehensive earlier privilege review is acceptable; local dependencies already exist; private unrecorded Mac terminal; no screen sharing, shell tracing or diagnostic/TLS key logging; operational monitoring/stop conditions are agreed. Unknown Production ACLs or proxy authentication policy can still cause a fail-closed refusal. Do not change any setting to overcome it.

**After explicit approval only**, paste this block once into the Mac's existing zsh Terminal, not Railway Console. Enter the existing certificates' unquoted absolute file paths when prompted, then the administrator password at the hidden prompt. Do not put a password or database URL into this block or into chat.

```zsh
(
  cd /Users/abdelrahmanomar/.codex/worktrees/promotions-phase1a/Central-Studio-System-main || exit 1
  read -r 'inventory_ca?Absolute path to the authenticated service root.crt: ' || exit 1
  read -r 'inventory_leaf?Absolute path to the authenticated service server.crt: ' || exit 1
  PATH="/opt/homebrew/bin:$PATH" lib/db/node_modules/.bin/tsx scripts/src/promotionsInventoryPinned.ts \
    --approved-read-only-inventory --approved-pinned-admin-transport \
    "$inventory_ca" "$inventory_leaf"
)
```

No password/URL is stored in shell variables by this block. The CLI keeps the password transiently in its own process memory, as required for authentication. On success, retain the printed private report path; do not paste raw files publicly. On any failure, stop. Do not retry, weaken TLS, refresh pins from the network, alter roles/grants or substitute manual SQL exports. Review the failure separately.

## Sources and boundaries

- [Railway service shell/SSH capabilities](https://docs.railway.com/cli/ssh).
- [Official PostgreSQL 18 image Dockerfile](https://raw.githubusercontent.com/railwayapp-templates/postgres-ssl/main/Dockerfile.18). A mutable tag/current source does not prove the deployed digest or installed runtime.
- [Node TLS custom server-identity verification](https://nodejs.org/api/tls.html#tlscheckserveridentityhostname-cert). CA verification remains mandatory; exact service pinning is the explicitly proposed identity policy, not a claim of matching proxy DNS.
- [node-postgres SSL configuration](https://node-postgres.com/features/ssl). Explicit client fields avoid URL parameters replacing the TLS policy.
- [PostgreSQL SET ROLE](https://www.postgresql.org/docs/current/sql-set-role.html). Role switches affect this session only and do not apply login-time role defaults.

**Production inventory NOT EXECUTED. Production data status UNKNOWN.** Production release remains NO-GO pending inventory, assessment and existing release gates. No Production data mutations, role/grant/configuration changes, migration execution, commit, push or deployment were performed. Awaiting Owner review and explicit authorization of the recommended alternative and inventory execution.
