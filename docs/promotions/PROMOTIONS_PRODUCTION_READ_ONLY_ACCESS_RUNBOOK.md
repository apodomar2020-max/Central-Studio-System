# Promotions Production Read-Only Access Runbook

Status: **PREPARATION DOCUMENT ONLY. Tool locally verified; Production ACCESS BLOCKED.** No access provisioning, Production query, migration or deployment is authorized by this document. Owner approval is required separately for preparation and for the eventual assessment window. Railway login is not database authorization.

## 1. Preparation — identify target and operator

The responsible Central Studio database/security operator must identify the intended Railway project, environment, PostgreSQL service and approved database/replica from existing architecture records and non-secret configuration metadata. Confirm actual PostgreSQL version, schema, endpoint route and current service linkage. Project labels alone are insufficient. Do not export Railway variables or use runtime `DATABASE_URL`, migrator, backup or administrative credentials as inventory credentials.

Record an internal target reference and independently verified server/database fingerprint, source/replica classification and operator approval reference. Keep raw host/database/user/provider identifiers and connection strings out of shared reports. Confirm the five `public` relations below are expected base tables, not unexpected views/foreign relations, and that the role's search path resolves to these approved relations. A dedicated identity must own no objects or personal schema that could shadow table names. Verify RLS cannot silently filter the approved inventory; do not bypass RLS or change policies as a workaround.

An existing approved read-only profile is preferred. If none exists, stop until the Owner separately authorizes a database operator to prepare one. The following is a **proposed preparation procedure**, not a claim that such a profile exists.

## 2. Preparation — proposed dedicated identity, not executed

Use the existing approved connection path/TLS trust chain and secret manager. Do not create a new public endpoint, tunnel, Railway service or unrestricted database URL. If a new path is necessary, obtain its separate infrastructure authorization.

An authorized role-administration operator may prepare a dedicated identity after reviewing cluster-wide role naming and target-specific grants. No runtime, migrator, owner, superuser, replication, bypass-RLS or predefined privileged role membership. PostgreSQL roles are cluster-wide; NOINHERIT alone does not exclude SET ROLE, so require **zero role memberships**, including indirect privileged paths. [PostgreSQL role attributes](https://www.postgresql.org/docs/current/sql-createrole.html), [role membership](https://www.postgresql.org/docs/current/role-membership.html).

SQL examples below are documentation only. They were **not executed, including on the disposable test cluster**. Substitute the approved database identifier with psql's identifier quoting; never substitute a credential or raw URL.

```sql
-- Future separately authorized operator session only.
-- psql variable inventory_db must be set to the independently approved DB name.
CREATE ROLE central_promotions_inventory_ro NOLOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1;
ALTER ROLE central_promotions_inventory_ro
  SET default_transaction_read_only = on;
ALTER ROLE central_promotions_inventory_ro SET statement_timeout = '5s';
ALTER ROLE central_promotions_inventory_ro SET lock_timeout = '500ms';
ALTER ROLE central_promotions_inventory_ro
  SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE central_promotions_inventory_ro SET search_path = public;
GRANT CONNECT ON DATABASE :"inventory_db" TO central_promotions_inventory_ro;
GRANT USAGE ON SCHEMA public TO central_promotions_inventory_ro;

GRANT SELECT (id,type,is_active,rules_config,discount_type,discount_value,
              start_date,end_date)
  ON public.promotions TO central_promotions_inventory_ro;
GRANT SELECT (id,promotion_id,code,current_uses)
  ON public.promotion_codes TO central_promotions_inventory_ro;
GRANT SELECT (id,promotion_id,promotion_code_id,package_order_id,booking_id,
              discount_amount)
  ON public.promotion_redemptions TO central_promotions_inventory_ro;
GRANT SELECT (id,is_active)
  ON public.price_packages TO central_promotions_inventory_ro;
GRANT SELECT (id,flow_type,package_order_id,booking_id,discount_amount_minor)
  ON public.payment_records TO central_promotions_inventory_ro;
```

No student/customer/contact fields, code usage-limit fields, payment credentials, payment references, audit bodies, operation responses, sequences or future-table/default privileges are required. Grouped counts need only the listed columns. The tool reads code/rules values privately to classify them but never exports their raw text.

Default read-only settings are defense in depth, not a substitute for privilege review: a login can otherwise change ordinary session settings. Grant no write authority. Check inherited PUBLIC privileges as well as direct grants. PUBLIC database TEMP/CREATE, schema CREATE, broad SELECT, unsafe function execution or existing memberships can defeat the intended least-privilege boundary. Revoking from this role does not negate PUBLIC grants. Do **not** automatically revoke PUBLIC permissions across an existing environment; evaluate application impact and obtain separate approval for any necessary shared-ACL correction. If effective permissions cannot meet the boundary, access remains BLOCKED. [PostgreSQL privileges](https://www.postgresql.org/docs/current/ddl-priv.html).

After successful privilege/target review, the authorized operator sets the authentication secret using the approved secure mechanism (for example interactive psql `\password` in a secured operator session, never password literals in SQL/history), enables LOGIN only for the approved assessment, and records rotation/expiry policy. Password expiry is not session termination and must not be the sole revocation mechanism. No such operation was performed here.

## 3. Authorization — effective-permission gate

Use an approved operator/preflight identity to inspect the intended role, then verify session behavior through that dedicated role only after Owner authorization. These checks are **not executed in this task**. Do not test Production denial by attempting DML.

Required recorded results, with no secret values:

1. Expected target fingerprint, role identity, PostgreSQL version and approved schema; zero privileged role flags and zero memberships.
2. No ownership of database, schemas, relations, routines or other user objects. Verify ownership comprehensively through catalogs/dependencies, not only table grants.
3. Effective CONNECT and exact required column SELECT; no effective table/column writes, sequence privileges, schema/database CREATE/TEMP, broad customer-data SELECT or unsafe SECURITY DEFINER execution. Review PUBLIC and all inherited paths.
4. Exact approved table resolution and complete, authorized RLS visibility. Any uncertainty blocks the inventory rather than silently filtering evidence.
5. Read-only session/transaction, statement/lock/idle limits, approved TLS/server identity and no URL startup overrides.

Illustrative catalog checks (operator retains restricted detailed results; shared report contains booleans/minimal references):

```sql
SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
FROM pg_roles WHERE rolname='central_promotions_inventory_ro';
-- All flags must be false. Direct memberships must be zero.
SELECT count(*) AS memberships
FROM pg_auth_members
WHERE member=(SELECT oid FROM pg_roles
              WHERE rolname='central_promotions_inventory_ro');
SELECT
  has_database_privilege('central_promotions_inventory_ro',current_database(),
                         'CONNECT') AS can_connect,
  has_database_privilege('central_promotions_inventory_ro',current_database(),
                         'CREATE') AS can_create,
  has_database_privilege('central_promotions_inventory_ro',current_database(),
                         'TEMP') AS can_temp;
-- Expected true, false, false; PUBLIC defaults may require separate review.

-- Expected zero. Column-level and PUBLIC/inherited grants are included.
SELECT count(*) AS writable_relations
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
  AND c.relkind IN ('r','p','v','m','f')
  AND (has_table_privilege('central_promotions_inventory_ro',c.oid,
                         'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege('central_promotions_inventory_ro',c.oid,
                               'INSERT,UPDATE,REFERENCES'));

-- Expected zero; inspect schema ownership separately as well.
SELECT count(*) AS creatable_schemas FROM pg_namespace
WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema'
  AND has_schema_privilege('central_promotions_inventory_ro',oid,'CREATE');

-- Each result requires operator review; no unaudited write-capable function.
SELECT count(*) AS executable_user_security_definers
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
  AND p.prosecdef
  AND has_function_privilege('central_promotions_inventory_ro',p.oid,'EXECUTE');
```

The examples are required components, not an exhaustive universal privilege auditor. Check effective SELECT and SELECT WITH GRANT OPTION on every required column, verify no extra sensitive-column/table SELECT, no role/objects owned indirectly, no user sequence USAGE/UPDATE, and no version-specific MAINTAIN or other elevated grants. PG16+ membership flags differ from older versions; use the actual version's catalogs. Zero memberships avoids relying on NOINHERIT or SET ROLE assumptions. [Privilege inquiry functions](https://www.postgresql.org/docs/current/functions-info.html).

On the authorized inventory connection, a separately approved metadata-only preflight can verify `current_user=session_user`, `pg_is_in_recovery()`, read-only/isolation/timeout settings and target fingerprint. Check `row_security_active()` for each required table in the dedicated role's context. Do not output raw connection identities in the shared evidence. The inventory itself asserts transaction read-only; the preflight must separately establish effective role scope and target identity.

Replica: record replay lag from the responsible operator's existing monitoring and evidence time. Obtain an Owner-approved maximum acceptable lag. A stale replica can miss new codes/redemptions/ownership changes; if lag is unknown or exceeds the approved threshold, stop. Do not promote/switch replicas, alter settings or fetch customer data to compensate.

## 4. Execution — later separately authorized window

Bind approval to the exact candidate manifest/tool SHA-256, dedicated access-profile reference, target, operator, window, load observer, cancellation contact and retention policy. Confirm no migration runner, API, Worker, backup job or app startup is involved. Railway/API predeploy commands must not be invoked.

The approved secret loader must populate `PROMOTIONS_INVENTORY_DATABASE_URL` into this one process/session without exposing it in arguments, shell trace, history, screenshots or reports. A concrete existing loader has not been supplied; selecting and approving it is still a prerequisite. Use TLS/server verification according to the approved provider profile; do not disable certificate checks. URL parameters cannot override inventory session settings.

Bounds: one connection; 5s connection/statement; 500ms lock; 15s idle transaction; 10,000 Promotions; 50,000 codes/packages; 16 MiB logical rules/code input; 10,000 entries per anomaly/review/reference category; **4 MiB exact pretty-printed UTF-8 JSON including final newline**. Do not relax limits. The serialized-output bound is separate from the logical-input bound.

Run once from the reviewed isolated candidate via the approved runtime, with private output staging:

```sh
set +x
umask 077
# Approved secret loader populates PROMOTIONS_INVENTORY_DATABASE_URL here.
# Do not echo it. Do not substitute application/admin credentials.
# Set private_output_dir to the already approved restricted output directory.
# Use a new filename for this one authorized attempt.
inventory_status=0
lib/db/node_modules/.bin/tsx scripts/src/promotionsInventory.ts \
  --approved-read-only-inventory > "$private_output_dir/inventory.pending.json" \
  2> "$private_output_dir/inventory.stderr.txt" || inventory_status=$?
unset PROMOTIONS_INVENTORY_DATABASE_URL
if [ "$inventory_status" -ne 0 ]; then
  echo "Inventory failed; do not publish pending output or retry automatically." >&2
  exit "$inventory_status"
fi
python3 - "$private_output_dir/inventory.pending.json" <<'PYVALIDATE'
import json, pathlib, sys
try:
    payload = pathlib.Path(sys.argv[1]).read_bytes()
    report = json.loads(payload)
    assert len(payload) <= 4 * 1024 * 1024
    assert report["version"] == 2 and report["readOnly"] is True
    assert report["limits"]["outputBytes"] == 4 * 1024 * 1024
except Exception:
    raise SystemExit(1)
PYVALIDATE
validation_status=$?
if [ "$validation_status" -ne 0 ]; then
  echo "Output validation failed; retain as failed evidence only." >&2
  exit "$validation_status"
fi
mv "$private_output_dir/inventory.pending.json" "$private_output_dir/inventory.json"
```

The operator wrapper must preserve the inventory exit code before `unset` or another command, and must not treat an empty/partial pending file as a report. On failure quarantine the pending file as failed evidence; do not publish it as clean JSON. A complete report is emitted only after every bound and serialization check and successful read-only COMMIT. Output version is 2. Do not auto-retry.

## 5. Monitoring and cancellation

Choose an approved low-traffic window. Observer uses existing authorized monitoring, not extra privileges granted to the inventory role. Track database load, replica lag, lock waits, run duration and the single session tagged `central-promotions-inventory`. The fixed aggregate queries can scan redemption/payment tables; output limits do not bound scan cost. Two count-distinct aggregates share the existing redemption-count query; no new table scan/query was added for classifications.

Stop on wrong target/role, unknown/excessive replica lag, lock contention, timeout, unexpected output, load outside the approved envelope or missing read-only evidence. Each statement is bounded, but total wall time across statements is longer than five seconds. Owner/operator must define the total run deadline and load threshold before execution; do not invent a universal safe load percentage. On breach, interrupt the inventory process or have the already authorized observer cancel its exact backend. No `pg_signal_backend`/monitoring grants are needed for the inventory identity. Ensure rollback/session closure and record the failure; do not increase limits or automatically rerun.

## 6. Evidence review and access closure

Verify exit status, version 2, readOnly, exact source hash, reported limits, complete JSON and output bytes. Record start/end times, non-secret target/profile reference, observer/load/lag evidence, active anomaly categories and minimal IDs. Broad-audience flags are review categories, not proof of eligibility or misconfiguration. Invalid/null rules, ownership and historical Finance findings require separate business review. Zero uses does not prove undistributed codes.

Store outputs under the approved internal access/retention policy; no public uploads, credentials, raw codes, raw rules or customer personal data. Owner reviews findings before runtime/remediation/release choices. A clean inventory does not authorize migration 0137 or deployment.

At window end, remove the secret from the session/runner, confirm connection closure, and ask the responsible operator to rotate/revoke the temporary identity according to the separately approved plan. NOLOGIN prevents future login but does not terminate existing sessions; terminate only the verified assessment backend if separately authorized and necessary. Review direct grants and retention before later role removal; do not use destructive cascade cleanup. Access preparation, revocation/rotation and any shared-ACL change require their own operator authorization and were not performed here.

## Final operator checklist

- [ ] Owner approves exact target/profile/tool hash, least-privilege preparation if needed, window and observer.
- [ ] Effective permissions, ownership, memberships, PUBLIC, RLS, TLS and replica freshness pass.
- [ ] Existing approved secret mechanism selected; no runtime/admin credential reuse.
- [ ] One bounded execution; no migration, API startup, write test or automatic retry.
- [ ] Successful exit AND complete bounded JSON before promoting evidence.
- [ ] Owner reviews anomalies/customer impact; access closed/rotated as separately approved.

**Current state: tool READY locally; Production inventory ACCESS BLOCKED. Production/staging access and provisioning have not been performed.**
