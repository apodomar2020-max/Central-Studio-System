import { and, eq, inArray, sql } from "drizzle-orm";
import { db, childrenTable, balletApplicationsTable } from "@workspace/db";
import { BALLET_ACTIVE_APPLICATION_STATUSES } from "@workspace/api-zod";

export const MAX_CHILD_PROFILES = 4;
export const MAX_CURRENT_BALLET_CHILDREN = 2;
type CapacityClient = Pick<typeof db, "select" | "execute">;

export class AccountCapacityError extends Error {
  readonly status = 422;
  constructor(
    readonly code: "CHILD_PROFILE_LIMIT_REACHED" | "BALLET_CHILD_LIMIT_REACHED",
    readonly limit: number,
    readonly currentCount: number,
    message: string,
  ) { super(message); }
  toResponse() {
    return { error: this.message, code: this.code, limit: this.limit, currentCount: this.currentCount };
  }
}

/** All profile/application creation paths take this lock BEFORE counting.
 * Reserved namespace follows the existing two-key promotion lock convention.
 * Call only inside a READ COMMITTED transaction, so a waiter sees committed writes.
 */
export async function lockAccountCapacity(tx: CapacityClient, accountId: number): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(918204, ${accountId})`);
}

export async function assertChildProfileCapacity(tx: CapacityClient, accountId: number): Promise<void> {
  const [row] = await tx.select({ total: sql<number>`count(*)::int` }).from(childrenTable)
    .where(eq(childrenTable.parentId, accountId));
  const count = Number(row?.total ?? 0);
  if (count >= MAX_CHILD_PROFILES) throw new AccountCapacityError(
    "CHILD_PROFILE_LIMIT_REACHED", MAX_CHILD_PROFILES, count,
    "This account has reached the maximum of 4 child profiles.",
  );
}

/** Keep the existing mobile journey identity: linked ID is authoritative;
 * legacy records use trimmed lowercase snapshot name + birthday. Never infer
 * a parent association or consolidate separate saved profiles.
 */
export async function assertBalletChildCapacity(tx: CapacityClient, accountId: number): Promise<void> {
  const [row] = await tx.select({ total: sql<number>`count(distinct case
    when ${balletApplicationsTable.childId} is not null then 'child:' || ${balletApplicationsTable.childId}::text
    else 'legacy:' || lower(trim(${balletApplicationsTable.childName})) || ':' || coalesce(${balletApplicationsTable.childBirthday}, 'unknown-birthday')
    end)::int` }).from(balletApplicationsTable).where(and(
      eq(balletApplicationsTable.parentStudentId, accountId),
      inArray(balletApplicationsTable.status, BALLET_ACTIVE_APPLICATION_STATUSES),
    ));
  const count = Number(row?.total ?? 0);
  if (count >= MAX_CURRENT_BALLET_CHILDREN) throw new AccountCapacityError(
    "BALLET_CHILD_LIMIT_REACHED", MAX_CURRENT_BALLET_CHILDREN, count,
    "This account has reached the maximum of 2 children with current Ballet applications or enrollment.",
  );
}
