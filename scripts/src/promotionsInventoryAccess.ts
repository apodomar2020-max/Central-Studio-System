import type pg from "pg";

/** Exact column boundary of the existing eight inventory SELECTs. */
export const INVENTORY_COLUMNS = Object.freeze({
  promotions: [
    "id",
    "type",
    "is_active",
    "rules_config",
    "discount_type",
    "discount_value",
    "start_date",
    "end_date",
  ],
  promotion_codes: ["id", "promotion_id", "code", "current_uses"],
  promotion_redemptions: [
    "id",
    "promotion_id",
    "promotion_code_id",
    "package_order_id",
    "booking_id",
    "discount_amount",
  ],
  price_packages: ["id", "is_active"],
  payment_records: [
    "id",
    "flow_type",
    "package_order_id",
    "booking_id",
    "discount_amount_minor",
  ],
});

/** Metadata only, on the same connection, before dropping session privileges. */
export async function verifyInventoryTransport(
  client: Pick<pg.Client, "query">,
  database: string,
) {
  const state = (
    await client.query(`select current_database() db, current_user actor,
    current_user=session_user original_actor, ssl, version from pg_catalog.pg_stat_ssl
    where pid=pg_backend_pid()`)
  ).rows[0];
  if (
    !state ||
    state.db !== database ||
    state.actor !== "postgres" ||
    !state.original_actor ||
    !state.ssl ||
    !["TLSv1.2", "TLSv1.3"].includes(state.version)
  )
    throw new Error("Restricted inventory preflight failed");
}

/** Metadata only. Must succeed after SET LOCAL ROLE, before any business SELECT. */
export async function verifyInventoryRole(
  client: Pick<pg.Client, "query">,
  database: string,
) {
  const fail = () => {
    throw new Error("Restricted inventory preflight failed");
  };
  const state = (
    await client.query(`select current_database() db, current_user actor,
    current_setting('transaction_read_only') ro,
    current_setting('transaction_isolation') isolation,
    current_setting('statement_timeout') statement_timeout,
    current_setting('lock_timeout') lock_timeout,
    current_setting('idle_in_transaction_session_timeout') idle_timeout,
    r.rolsuper, r.rolcreatedb, r.rolcreaterole,
    r.rolreplication, r.rolbypassrls, r.rolcanlogin, r.rolinherit
    from pg_catalog.pg_roles r
    where r.rolname=current_user`)
  ).rows[0];
  if (
    !state ||
    state.db !== database ||
    state.actor !== "central_promotions_inventory_ro" ||
    state.ro !== "on" ||
    state.isolation !== "repeatable read" ||
    state.statement_timeout !== "5s" ||
    state.lock_timeout !== "500ms" ||
    state.idle_timeout !== "15s" ||
    [
      state.rolsuper,
      state.rolcreatedb,
      state.rolcreaterole,
      state.rolreplication,
      state.rolbypassrls,
      state.rolcanlogin,
      state.rolinherit,
    ].some(Boolean)
  )
    fail();
  const memberships = (
    await client.query(`select count(*)::int n from pg_catalog.pg_auth_members
    where member=(select oid from pg_catalog.pg_roles where rolname=current_user)`)
  ).rows[0];
  if (memberships.n !== 0) fail();
  // Scan catalog metadata, never customer/business rows. Check effective ACLs,
  // including PUBLIC and column grants; selecting a view is not a substitute.
  const columns = (
    await client.query(`select n.nspname schema, c.relname name, c.relkind kind,
    a.attname col, pg_catalog.has_column_privilege(c.oid,a.attnum,'SELECT') can_read,
    pg_catalog.has_column_privilege(c.oid,a.attnum,'INSERT,UPDATE,REFERENCES') can_write,
    c.relowner=(select oid from pg_catalog.pg_roles where rolname=current_user) owns,
    c.relrowsecurity rls
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    where c.relkind in ('r','p','v','m','f')
      and n.nspname not in ('pg_catalog','information_schema')
      and n.nspname not like 'pg_toast%' limit 100001`)
  ).rows;
  if (columns.length > 100000) fail();
  const found = new Set<string>();
  for (const col of columns) {
    const approved =
      col.schema === "public" &&
      Object.hasOwn(INVENTORY_COLUMNS, col.name) &&
      INVENTORY_COLUMNS[col.name as keyof typeof INVENTORY_COLUMNS].includes(
        col.col,
      );
    if (col.can_write || col.owns || (col.can_read && !approved)) fail();
    if (approved) {
      if (!col.can_read || col.kind !== "r" || col.rls) fail();
      found.add(`${col.name}.${col.col}`);
    }
  }
  if (
    !(
      await client.query(
        "select pg_catalog.has_schema_privilege('public','USAGE') ok",
      )
    ).rows[0].ok
  )
    fail();
  for (const [table, names] of Object.entries(INVENTORY_COLUMNS)) {
    for (const name of names) if (!found.has(`${table}.${name}`)) fail();
  }
  const writes = (
    await client.query(`select count(*)::int n
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'
    and ((c.relkind in ('r','p','v','m','f') and
      pg_catalog.has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN'))
      or (c.relkind='S' and pg_catalog.has_sequence_privilege(c.oid,'USAGE,SELECT,UPDATE')))`)
  ).rows[0];
  if (writes.n !== 0) fail();
}
