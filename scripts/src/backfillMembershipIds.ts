/**
 * Membership Engine backfill — idempotent, NOT run automatically.
 *
 * Fills in the owner FK (student_id / account_owner_student_id) on rows
 * that have a matching students.email but are missing the FK — either
 * legacy rows, or rows created before the owning column existed
 * (package_orders.student_id was added in migration 0034).
 *
 * Safe to re-run any number of times: every UPDATE is scoped to
 * `WHERE <fk> IS NULL`, so already-backfilled or genuinely-unmatched rows
 * (no student with that email exists) are left untouched on subsequent runs.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @workspace/scripts run backfill-membership-ids
 *   DATABASE_URL=postgres://... pnpm --filter @workspace/scripts run backfill-membership-ids -- --dry-run
 *
 * --dry-run prints how many rows *would* be updated in each table without
 * writing anything. Always run with --dry-run first against a database you
 * have reviewed before running for real.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

const DRY_RUN = process.argv.includes("--dry-run");

interface BackfillTarget {
  label: string;
  /** Counts rows that would be updated. */
  countSql: ReturnType<typeof sql>;
  /** Performs the update. Only run when DRY_RUN is false. */
  updateSql: ReturnType<typeof sql>;
}

const targets: BackfillTarget[] = [
  {
    label: "package_orders.student_id",
    countSql: sql`
      select count(*)::int as n
      from package_orders po
      join students s on lower(trim(po.student_email)) = lower(trim(s.email))
      where po.student_id is null
    `,
    updateSql: sql`
      update package_orders po
      set student_id = s.id
      from students s
      where po.student_id is null
        and lower(trim(po.student_email)) = lower(trim(s.email))
    `,
  },
  {
    label: "attendance.student_id",
    countSql: sql`
      select count(*)::int as n
      from attendance a
      join students s on lower(trim(a.student_email)) = lower(trim(s.email))
      where a.student_id is null
    `,
    updateSql: sql`
      update attendance a
      set student_id = s.id
      from students s
      where a.student_id is null
        and lower(trim(a.student_email)) = lower(trim(s.email))
    `,
  },
  {
    label: "bookings.account_owner_student_id",
    countSql: sql`
      select count(*)::int as n
      from bookings b
      join students s on lower(trim(b.student_email)) = lower(trim(s.email))
      where b.account_owner_student_id is null
    `,
    updateSql: sql`
      update bookings b
      set account_owner_student_id = s.id
      from students s
      where b.account_owner_student_id is null
        and lower(trim(b.student_email)) = lower(trim(s.email))
    `,
  },
  {
    label: "feedback.student_id",
    countSql: sql`
      select count(*)::int as n
      from feedback f
      join students s on lower(trim(f.student_email_snapshot)) = lower(trim(s.email))
      where f.student_id is null
    `,
    updateSql: sql`
      update feedback f
      set student_id = s.id
      from students s
      where f.student_id is null
        and lower(trim(f.student_email_snapshot)) = lower(trim(s.email))
    `,
  },
  {
    // Runs last on purpose: derives from package_orders.student_id, so it
    // only finds fresh matches after the package_orders pass above (in the
    // same run) has filled that column in.
    label: "credit_transactions.student_id (via package_orders)",
    countSql: sql`
      select count(*)::int as n
      from credit_transactions ct
      join package_orders po on po.id = ct.package_order_id
      where ct.student_id is null and po.student_id is not null
    `,
    updateSql: sql`
      update credit_transactions ct
      set student_id = po.student_id
      from package_orders po
      where ct.student_id is null
        and po.id = ct.package_order_id
        and po.student_id is not null
    `,
  },
];

async function main() {
  console.log(`Membership ID backfill — ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}\n`);

  for (const target of targets) {
    const countResult = await db.execute(target.countSql);
    const n = Number((countResult.rows[0] as { n: number } | undefined)?.n ?? 0);

    if (n === 0) {
      console.log(`  ${target.label}: nothing to backfill`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`  ${target.label}: ${n} row(s) would be updated`);
      continue;
    }

    await db.execute(target.updateSql);
    console.log(`  ${target.label}: ${n} row(s) updated`);
  }

  console.log(`\n${DRY_RUN ? "Dry run complete." : "Backfill complete."}`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
