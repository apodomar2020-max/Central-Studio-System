# Promotions Production Read-Only Access Setup Report

Date: 2026-10-25, Africa/Cairo.

## 1. Executive verdict

**BLOCKED ON ADMIN ACCESS. No read-only role was created or reused. Effective Production privileges were not verified.**

The Owner authorized narrowly scoped provisioning only after prerequisites are demonstrably satisfied. The later clarification states that no administrative profile/session has been established and instructs that no credentials or database commands be used until the mechanism is established. This report therefore provides concrete Owner steps, not another request for an unknown profile name.

Railway project metadata is available; a verified administrative PostgreSQL connection and secure credential/session procedure are not. No database connection, SQL command, role creation, credential retrieval, security configuration change, inventory execution or business-record read occurred. Production data remains UNKNOWN and release NO-GO.

**Exact next Owner action:** open the existing Central Studio project in Railway, select **Production**, open the existing PostgreSQL service, then inspect **Settings → Networking** for an **already-existing** TCP/Public Access route. Do not click Add Public Access, reveal/copy passwords, open customer tables or run commands. Record only the database service label and whether an existing route is present. Follow the decision steps below; no new public route or configuration change is approved.

## 2. Verified Railway/PostgreSQL context

| Surface | What was actually established |
|---|---|
| Repository | Isolated worktree `/Users/abdelrahmanomar/.codex/worktrees/promotions-phase1a/Central-Studio-System-main`; branch `codex/promotions-phase1a`; HEAD and remote main `2b3ab9f5e3568f90ee468707a19992f7b229fb2c`. |
| Candidate preservation | All 41 existing candidate/report files match the last saved inventory-readiness manifest; no baseline integration conflict. |
| Railway metadata | Status-only project metadata returned successfully from the existing linked project context: five project services, one Production environment label and a PostgreSQL-named service. |
| Metadata limitation | Project/service names do not prove the physical database, correct Production service instance, SQL identity, TLS trust or role administration authority. |
| Local clients | Railway CLI **5.15.0**, psql **18.4** available. Only version/help commands were used; no connect or SSH session ran. |
| Database access availability | No database/admin connection environment variable or PostgreSQL service/password profile was available in the scoped checks. No approved secret-loading mechanism was supplied. |

The original dirty Downloads checkout's complete Git status is unchanged. Its existing Railway project context was used only for status metadata. No link, service switch, configuration edit, reset, clean, rebase, staging, commit or push occurred.

Official Railway documents support PostgreSQL administration through a database client using existing connectivity. Creating Public Access would create a TCP proxy; it is a configuration change, so it must not be used here as an automatic way around missing access. [Railway PostgreSQL connection documentation](https://docs.railway.com/databases/postgresql).

## 3. Existing access investigation and practical Owner procedure

### Findings from current source and documentation

- `scripts/security/configure-database-roles.sql` describes `central_runtime` and `central_migrator` separation, but also reassigns ownership, modifies existing roles, changes shared PUBLIC/schema privileges and broad/default grants. **Do not run it for this task.** It exceeds the single-identity boundary.
- `scripts/security/configure-backup-role.sql` describes `central_backup`, with broad table/sequence SELECT and default grants. It is not the minimum-column inventory identity and must not be reused or reconfigured.
- `artifacts/api-server/scripts/database-role-boundaries.mjs`, `railway-start.mjs` and migration entry point separate runtime `DATABASE_URL` from deploy-time `MIGRATION_DATABASE_URL`, removing the latter before runtime. A migration credential name does not demonstrate role-creation authority; the documented migrator role is not a generic database administrator.
- Existing grant/deployment reports are historical context, not current privilege proof. Actual runtime/migrator/backup/read-only role existence and grants were not queried.
- No verified existing administration session, secure loader, or approved reusable narrow read-only identity was found. No Railway variables, service secrets, passwords, tokens or private keys were requested/exported.

### Important installed-client finding

Railway CLI **v5.15.0** builds its PostgreSQL client invocation with the connection URL as a process argument, for both its direct and SSH-connect paths. A credential-bearing URL would violate this task's no-secret-in-arguments rule. I did not run `railway connect`. This finding is from the matching official version's implementation, not speculation about a future CLI. [Railway CLI v5.15.0 connect source](https://raw.githubusercontent.com/railwayapp/cli/v5.15.0/src/commands/connect.rs).

Current documentation describes `--tunnel-only`, which prints connection details including credentials; that flag is absent from installed v5.15.0 and is not an appropriate workaround. No CLI update, key registration, tunnel or platform configuration change was attempted. [Railway connect documentation](https://docs.railway.com/cli/connect).

### Owner steps — establish the mechanism first

1. **Select the target in Railway.** Open the existing Central Studio project and explicitly select **Production**. Open the existing PostgreSQL service, not API, Worker or backup. Do not use New/Add, deploy, restart or change environment variables.
2. **Inspect existing networking only.** In service **Settings → Networking**, determine whether TCP/Public Access already exists. Do not add it. Keep host/port/service identifiers in your private operator notes; never send a connection URL/password or screenshot of Variables into chat.
3. **Choose the already-supported route.** If an existing public TCP route exists, the proposed path is a direct local psql session with a hidden password prompt and verified TLS. If there is no public route, use only an already-authorized private operator/SSH transport. Railway supports service SSH, but establishing a new key/route or using an unreviewed tunnel is not authorized by this task. If neither route is established, **stop here**: a responsible operator must prepare/review a supported private administration path under separate authorization. Do not enable Public Access or deploy an administration UI as a workaround. [Railway service SSH documentation](https://docs.railway.com/cli/ssh).
4. **Establish secure operator handling.** Use your private, unrecorded local terminal or an existing trusted SQL client. Confirm approved certificate/server-identity validation, no terminal/screen recording or transcript/trace, and the authentication/secret-storage method. The proposal is a one-use hidden password prompt for administration, with no reusable privileged URL in the repository. No password needs to be sent to this assistant. Do not reveal/copy credentials until this route and handling procedure are established and explicitly accepted for operator use.
5. **Only after step 4 is established, connect privately.** The Owner/operator may obtain the database service's approved administrative authentication privately through the authorized provider mechanism. Do not take it from the API/Worker/backup service, export Railway variables, or reuse it for the inventory. Use the password prompt example below only with approved non-secret fields. If a verified certificate/trust path is unavailable, stop for operator review; do not disable TLS verification to make a connection work.
6. **Verify metadata first, still no business rows.** After the administration session itself is established, run only reviewed catalog/session metadata checks to confirm actual database/role/TLS, role-creation authority and required grant authority. Check the candidate role's existence before creating anything. If an existing identity already meets every restriction, prefer reuse. No successful connection alone establishes privilege safety.
7. **Stop before provisioning on any failed precondition.** PUBLIC privileges, inherited/SET ROLE paths, ownership, unsafe functions, default privileges, unexpected views/search path or RLS gaps must be reviewed. If compliance would require changing shared ACLs, other roles, traffic, networking or service configuration, stop and return for separate impact authorization. No global PUBLIC revoke is permitted.
8. **Provision only the approved identity, then verify it.** Once all prerequisites are actually proven, follow the narrow column-grant procedure in the access runbook; do not execute the general role scripts. Keep LOGIN disabled until secure credential handling and grants are ready, verify the restricted login using metadata only, and retain sanitized evidence. **Do not run the inventory.**

Steps 1–4 can establish the missing plan without a pre-existing profile name. Steps 5–8 are future operator actions after the mechanism is established; none was performed by this task. The Owner need only communicate non-secret target/route confirmation and handling/verification evidence, never credentials.

### Proposed direct-client command — not executed

This example is for an **already-existing approved TCP route**, after the preceding gates. All bracketed fields are non-secret placeholders. `-X` avoids startup-file commands and `-W` prompts for the password without putting it in arguments. The administrative credential is never an inventory connection. [PostgreSQL psql options](https://www.postgresql.org/docs/current/app-psql.html).

```sh
# Future private Owner/operator terminal only. No passwords in this command.
# Establish the correct route and trusted CA/server identity before use.
set +x
env -u PGPASSWORD -u PGSERVICE -u PGSERVICEFILE -u PGPASSFILE \
  PSQL_HISTORY=/dev/null psql -X -W \
  "host=<approved-host> port=<approved-port> dbname=<approved-database> user=<approved-admin-user> sslmode=verify-full sslrootcert=<approved-CA-file> connect_timeout=5 application_name=central-promotions-admin-preflight options='-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=500 -c idle_in_transaction_session_timeout=15000'"
```

This is not a claim that Railway's current certificate matches an arbitrary proxy hostname, or that a CA file has already been supplied. A TLS identity failure is a stop condition. An already-authorized authenticated private transport is an alternative for operator review; it must not be silently created or substituted.

The initial session is read-only for metadata preflight. Do not turn it writable or execute the role SQL until target, authority, ACL and secret-handling gates pass. The latest Owner instruction forbids database commands until the administration mechanism is established; therefore even the metadata checks below were not run here.

## 4. Exact identity used or proposed

**Proposed identity:** `central_promotions_inventory_ro`. This is a non-secret proposed role name, not proof of a live role. Existence is UNKNOWN until a verified catalog session is available. No existing role was reused, modified or assumed absent.

Required shape: dedicated inventory-only login; no ownership; NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS; NOINHERIT plus **zero role memberships/SET ROLE pathways**; connection limit 1. No grant options. Default read-only, 5s statement, 500ms lock, 15s idle and approved search path. Client connection timeout remains 5s.

Required access only:

| Relation | SELECT columns |
|---|---|
| `public.promotions` | id, type, is_active, rules_config, discount_type, discount_value, start_date, end_date |
| `public.promotion_codes` | id, promotion_id, code, current_uses |
| `public.promotion_redemptions` | id, promotion_id, promotion_code_id, package_order_id, booking_id, discount_amount |
| `public.price_packages` | id, is_active |
| `public.payment_records` | id, flow_type, package_order_id, booking_id, discount_amount_minor |

Plus CONNECT on the approved database and USAGE on the approved schema. No whole-database SELECT, customer/authentication tables, student IDs, payment credentials, sequences, default grants on future objects, schema CREATE or migration access. Raw code/rules values are required internally for classification, but never exported by the tool.

## 5. Was a new role actually created?

**No.** No CREATE ROLE, ALTER ROLE, GRANT, REVOKE, password generation, secret storage or login/session test was executed. No role SQL was sent to any database. The task stopped provisioning because a secure administrative mechanism and target/authority could not be verified, as required by the Owner's latest instruction.

## 6. Scope of Production security configuration change

**None.** Role creations/configurations/grants: zero. PUBLIC/application-role changes: zero. Railway networking/service/variable changes: zero. No SSH key registration, new access endpoint, database, role or tool deployment. No application migration or schema operation.

If a later operator establishes the mechanism and all checks pass, the existing narrow authorization covers only the dedicated inventory identity and listed grants/settings. Any shared-ACL, network, existing-role or application change remains outside it.

## 7. Effective privilege verification

| Required verification | Current result |
|---|---|
| Production database/replica identity, PostgreSQL version and server TLS | UNVERIFIED |
| Administrative SQL identity and role-creation authority | UNVERIFIED |
| Authority to grant required CONNECT/USAGE/column SELECT | UNVERIFIED |
| Existing candidate/read-only roles | UNKNOWN |
| Restricted login identity and exact allowed columns | NOT VERIFIED; no login exists here as a verified setup result |
| No table/column writes, TRUNCATE, CREATE, ALTER/DROP, sequences or grant options | NOT VERIFIED |
| No privileged flags, ownership, memberships, SET ROLE or migration authority | NOT VERIFIED |
| No unrelated customer/authentication/secret access | NOT VERIFIED |
| Complete approved RLS visibility and correct base-table/search-path resolution | NOT VERIFIED |
| Session read-only/timeout constraints and usable secure secret loading | NOT VERIFIED against Production |

The access runbook supplies catalog examples for effective privileges and ownership, not destructive permission tests. A future operator should retain booleans/minimal evidence, not customer rows or password catalogs. Check actual elevated attributes and grant authority; do not infer them from account ownership in Railway or names such as `postgres`/`readonly`. No Production INSERT/UPDATE/DELETE/TRUNCATE or attempted mutation test is permitted.

## 8. Role inheritance and PUBLIC findings

No live ACL/membership/ownership/default-privilege query was performed. Their actual values remain UNKNOWN. Repository scripts document intended separation and broad backup grants, but cannot establish live least privilege.

Required future metadata checks cover PUBLIC effective CONNECT/CREATE/TEMP and schema/object/function access; direct and inherited privileges; SET ROLE; every required SELECT column and unrelated sensitive SELECT; ownership; elevated attributes; executable SECURITY DEFINER functions; sequences; default grants; and RLS. A default READ ONLY setting or NOINHERIT flag alone is insufficient.

If shared grants provide prohibited capabilities to the prospective identity and cannot be neutralized solely within its own permissible configuration, **stop without revoking PUBLIC or existing-role privileges**. No broader ACL impact authorization is implied by the role-setup authorization. No claim is made that such a conflict is currently present or absent.

## 9. Authentication and secret-handling procedure

Administrative authentication handling is a proposed process awaiting establishment, not an available named profile. The preferred existing-route proposal uses Owner-held private authentication and a hidden prompt; no administrative URL/password is stored in Git, chat, reports, screenshots, shell arguments or transcripts. Secure TLS/server identity must be established independently.

If provisioning later succeeds, create an independent strong inventory credential through the approved password-manager/operator mechanism; never reuse API, migrator, backup or admin credentials. Validate that client/server logging does not record secret material. Store it in an Owner-approved secret manager or existing secured loader, outside the repository. The loader must inject only `PROMOTIONS_INVENTORY_DATABASE_URL` into the future inventory process without printing it. A concrete loader/store has not been selected or verified, so it is not described as operational.

No password, connection URL, token, private key or service-variable export was retrieved during this task. The CLI connect implementation was inspected as public source; it was not invoked. Local client version/help and Railway status metadata do not use database credentials.

## 10. Existing application/database impact

No changes to application code, schemas, migrations, role scripts, configuration, credentials, traffic, services, backups, jobs or historical records. All 41 initial worktree files are preserved byte-identically; this setup report is the sole repository addition. Original Downloads status is preserved. No runtime or mandatory enforcement flag was enabled.

No test/build rerun was needed for a documentation/metadata-only task. The previous 31 passing inventory safety tests, scripts/database typechecks and inventory build remain preserved evidence, not checks rerun here. The earlier 372-test application baseline and inherited 167 API diagnostics remain unchanged context.

## 11. Rotation and revocation procedure

Nothing was provisioned, so no role/credential needs rotation or revocation as a result of this task. For a future approved identity, document credential expiry/rotation, secret-manager version, responsible operator and assessment window before enabling LOGIN. At closure, remove the credential from the runner/session, verify connection closure, then have the authorized operator disable/rotate only this inventory identity under the approved plan. NOLOGIN does not terminate existing connections; never terminate unrelated sessions or use destructive role-cascade cleanup. Preserve inventory evidence according to its approved retention policy.

Do not rotate application/admin/backup credentials or modify service configuration as part of this procedure. No such action occurred.

## 12. Inventory tool version and safety baseline

- Source: `scripts/src/promotionsInventory.ts`, local uncommitted candidate on the verified HEAD.
- SHA-256: `36ed0ee3129aac07debb4e8f840a3fac6b2ac765407b3863e633cf2db12e5421`.
- Output version: **2**; safety suite: **31 tests previously passed**, unchanged source/test hashes.
- One connection; explicit repeatable-read READ ONLY transaction; 5s connection/statement, 500ms lock, 15s idle.
- 10,000 Promotions; 50,000 codes/packages; 16 MiB logical input; 10,000 entries per bounded anomaly/review/reference category; 4 MiB exact serialized UTF-8 output.
- Fail-closed bounds/serialization before COMMIT; sanitized errors/no successful partial JSON; no customer personal data/raw codes/raw rules/credentials exported.

The inventory command was **not executed**, including as a connection test. Role setup, metadata verification and inventory execution are distinct authorizations/actions.

## 13. Remaining execution prerequisites

Before provisioning can resume: Owner completes target/route inspection and establishes the approved private administration/credential-handling procedure; actual metadata confirms database identity, role authority, grant authority, ACL/ownership/membership/default/RLS constraints and existing-role suitability. An approved inventory-only secret store/loader must be chosen and verified.

After successful setup, future inventory additionally needs confirmed target/replica and freshness, approved execution window, database load observer and envelope, total-run deadline/cancellation procedure, secure report destination, evidence access/retention policy and exact candidate manifest binding. Default count/statement limits do not replace operational review. No inventory run is authorized by a successful setup alone.

## 14. Exact remaining Owner/operator actions

**Already authorized:** narrow provisioning once security prerequisites actually pass. No repeat permission request for that same bounded action is needed. **Current blocker:** the administrative mechanism and its secure handling are not established; the latest clarification requires stopping before credential retrieval/database commands.

Concrete handoff:

1. Perform the Railway UI route check at the top of this report; no configuration change or credential sharing.
2. Establish the direct hidden-prompt + verified-TLS procedure on an existing route, or have a qualified database operator confirm an existing authorized private administration session. A profile name need not already exist.
3. Once established, an authorized operator performs metadata-only target/admin/grant/PUBLIC/ownership/RLS checks and records sanitized results. If broader changes are required, obtain a separate impact decision; otherwise proceed only with the dedicated identity under the existing narrow scope.
4. Securely store its independent credential, verify the restricted login's effective permissions using metadata only and supply a non-secret access reference plus verified results. Never send the password/URL into chat.
5. Separately approve the future inventory window/observer/output policy and inventory execution after access is genuinely READY. No commitment to deployment, migration 0137, remediation or runtime policy follows from that approval.

## 15. Final verdict and evidence

**BLOCKED ON ADMIN ACCESS. Read-only access is NOT READY.** The supported procedure and exact next Owner action are documented; no further open-ended profile-name question is required. Actual role provisioning and effective-privilege proof cannot be substituted by instructions, Railway sign-in, names or a successful generic connection.

Evidence bundle: `/Users/abdelrahmanomar/.codex/visualizations/2026/10/22/01a1631a-cb70-7dc1-aa7d-1918c1f2a789/promotions-readonly-access-setup`. It contains sanitized availability/platform/client metadata, initial/final manifests/status, preservation summary and this report. It contains no Production business output or credentials.

**Read-only access was not provisioned; effective Production privileges were not verified. Production inventory remains unexecuted. No Production security configuration change occurred. The next inventory execution is not ready for approval until administrative access is established, the restricted identity is verified and operational prerequisites are satisfied. No commit, push, deployment or application migration was performed.**
