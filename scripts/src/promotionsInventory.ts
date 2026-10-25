/** Read-only inventory. No application startup, credentials or customer data. */
import pg from "pg";
import { promotionRulesConfigSchema } from "@workspace/db/schema";
import { pathToFileURL } from "node:url";
import {
  verifyInventoryRole,
  verifyInventoryTransport,
} from "./promotionsInventoryAccess";

// Exported for operator documentation and exact boundary regressions. No CLI
// override can increase these approved limits.
export const INVENTORY_LIMITS = Object.freeze({
  promotions: 10000,
  codes: 50000,
  packages: 50000,
  anomalyGroups: 10000,
  packageReferences: 10000,
  logicalBytes: 16 * 1024 * 1024,
  outputBytes: 4 * 1024 * 1024,
});
class InventorySafetyError extends Error {}
function bounded(length: number, maximum: number, label: string) {
  if (length > maximum)
    throw new InventorySafetyError(
      `${label} ceiling exceeded; no complete inventory produced. Review a separately bounded plan.`,
    );
}
/** The exact pretty-printed UTF-8 representation used by the CLI. */
export function serializeInventory(result: unknown): string {
  const output = JSON.stringify(result, null, 2) + "\n";
  bounded(
    Buffer.byteLength(output, "utf8"),
    INVENTORY_LIMITS.outputBytes,
    "Serialized output byte",
  );
  return output;
}
export function inventoryFailureMessage(error: unknown): string {
  if (error instanceof InventorySafetyError) return error.message;
  const code = (error as { code?: string } | null)?.code;
  if (code === "57014")
    return "Inventory statement timed out or was cancelled; no complete inventory produced. Review load/window; do not increase limits automatically.";
  if (code === "55P03")
    return "Inventory lock timeout; no complete inventory produced. Cancel and review contention before a separately approved run.";
  return "Read-only inventory failed; no complete inventory produced. Verify approved target/access and safety prerequisites. Database details and credentials are suppressed.";
}

type PromotionRow = {
  id: number;
  type: string;
  is_active: boolean;
  rules_config: unknown;
  discount_type: string;
  discount_value: number;
};
type CodeRow = {
  id: number;
  promotion_id: number;
  code: string;
  current_uses: number;
  actual_uses: number;
};
export async function inventoryPromotions(connectionString: string) {
  // node-postgres gives URL parameters precedence over pool settings. Refuse
  // startup overrides rather than allowing a profile to disable safety limits.
  let connectionUrl: URL;
  try {
    connectionUrl = new URL(connectionString);
  } catch {
    throw new InventorySafetyError(
      "Inventory requires an approved PostgreSQL connection URL",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(connectionUrl.protocol) ||
    [...connectionUrl.searchParams.keys()].some((key) =>
      [
        "options",
        "application_name",
        "statement_timeout",
        "lock_timeout",
        "idle_in_transaction_session_timeout",
        "default_transaction_read_only",
        "replication",
        "connect_timeout",
        "query_timeout",
      ].includes(key.toLowerCase()),
    )
  )
    throw new InventorySafetyError(
      "Connection URL must not override inventory session settings; review the approved access profile",
    );
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
    application_name: "central-promotions-inventory",
    options:
      "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=500 -c idle_in_transaction_session_timeout=15000",
  });
  const client = await pool.connect().catch(async (error) => {
    await pool.end();
    throw error;
  });
  try {
    return await runInventory(client);
  } finally {
    client.release();
    await pool.end();
  }
}

/** Caller owns one connected, independently TLS-verified connection. */
export async function inventoryPromotionsOnClient(
  client: Pick<pg.Client, "query">,
  expectedDatabase: string,
) {
  return runInventory(client, expectedDatabase);
}

async function runInventory(
  client: Pick<pg.Client, "query">,
  expectedDatabase?: string,
) {
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    // SET ROLE does not apply ALTER ROLE defaults: set bounds on this session.
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '500ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
    await client.query("SET LOCAL search_path = pg_catalog, public");
    if (expectedDatabase !== undefined) {
      // pg_stat_ssl visibility can disappear after SET ROLE. Verify transport
      // using session metadata first; no business query precedes the role drop.
      await verifyInventoryTransport(client, expectedDatabase);
      await client.query("SET LOCAL ROLE central_promotions_inventory_ro");
      await verifyInventoryRole(client, expectedDatabase);
    }
    const mode = (await client.query("SHOW transaction_read_only")).rows[0]
      .transaction_read_only;
    if (mode !== "on")
      throw new InventorySafetyError(
        "Inventory requires a read-only transaction",
      );
    const bytes = (
      await client.query(
        "select (select coalesce(sum(octet_length(rules_config::text)),0) from promotions)+(select coalesce(sum(octet_length(code)),0) from promotion_codes) total",
      )
    ).rows[0].total;
    bounded(
      Number(bytes),
      INVENTORY_LIMITS.logicalBytes,
      "Inventory payload byte",
    );
    const promotions = (
      await client.query<PromotionRow>(
        "select id,type,is_active,rules_config,discount_type,discount_value from promotions order by id limit 10001",
      )
    ).rows;
    const codes = (
      await client.query<CodeRow>(`select c.id,c.promotion_id,c.code,c.current_uses,count(r.id)::int actual_uses
    from promotion_codes c left join promotion_redemptions r on r.promotion_code_id=c.id
    group by c.id order by c.id limit 50001`)
    ).rows;
    bounded(promotions.length, INVENTORY_LIMITS.promotions, "Promotion record");
    bounded(codes.length, INVENTORY_LIMITS.codes, "Code record");
    const packages = (
      await client.query<{ id: number; is_active: boolean }>(
        "select id,is_active from price_packages order by id limit 50001",
      )
    ).rows;
    bounded(packages.length, INVENTORY_LIMITS.packages, "Package record");
    const packagesById = new Map(packages.map((p) => [p.id, p]));
    const byPromotion = new Map<number, CodeRow[]>();
    for (const c of codes) {
      const list = byPromotion.get(c.promotion_id) ?? [];
      list.push(c);
      byPromotion.set(c.promotion_id, list);
    }
    const normalized = new Map<string, CodeRow[]>();
    for (const c of codes) {
      const k = c.code.trim().toUpperCase();
      const list = normalized.get(k) ?? [];
      list.push(c);
      normalized.set(k, list);
    }
    const packageReferences: Array<{
      promotionId: number;
      packageId: number;
      state: string;
    }> = [];
    const shapes: Record<string, number> = {};
    const issues: Array<{
      promotionId: number;
      active: boolean;
      categories: string[];
      codeIds: number[];
      redemptions: number;
    }> = [];
    const eligibilityReview: Array<{
      promotionId: number;
      active: boolean;
      rulesStatus: string;
      automaticWithoutAudienceRestrictions: boolean;
      packageBranchContextIncompatible: boolean;
      hasRuleUsageLimits: boolean;
    }> = [];
    for (const p of promotions) {
      const attached = byPromotion.get(p.id) ?? [],
        shape = `${["manual", "automatic"].includes(p.type) ? p.type : "unsupported"}:${attached.length === 0 ? "zero" : attached.length === 1 ? "one" : "multiple"}`;
      shapes[shape] = (shapes[shape] ?? 0) + 1;
      const categories: string[] = [];
      if (p.type === "manual" && attached.length !== 1)
        categories.push("ambiguous_manual_code_count");
      if (p.type === "automatic" && attached.length)
        categories.push("automatic_with_codes");
      if (!["manual", "automatic"].includes(p.type))
        categories.push("unsupported_type");
      if (
        !["percentage", "fixed_amount"].includes(p.discount_type) ||
        !Number.isFinite(p.discount_value) ||
        p.discount_value <= 0 ||
        (p.discount_type === "percentage" && p.discount_value > 100)
      )
        categories.push("invalid_discount");
      const rules = promotionRulesConfigSchema.safeParse(p.rules_config);
      if (!rules.success) categories.push("invalid_or_unsupported_rules");
      const rulesStatus =
        p.rules_config === null
          ? "null"
          : rules.success
            ? "valid"
            : typeof p.rules_config !== "object" ||
                Array.isArray(p.rules_config)
              ? "malformed"
              : rules.error.issues.some(
                    (issue) => issue.code === "unrecognized_keys",
                  )
                ? "unsupported"
                : "invalid";
      // Mirrors the established null fallback only for classification, never
      // changes runtime eligibility. Usage limits do not narrow the audience.
      const runtimeRules = rules.success
        ? rules.data
        : p.rules_config === null
          ? {}
          : null;
      const broad =
        p.type === "automatic" &&
        runtimeRules !== null &&
        !runtimeRules.verifiedStudentOnly &&
        !runtimeRules.firstPackagePurchaseOnly &&
        !(runtimeRules.minimumBasketAmount ?? 0) &&
        !runtimeRules.packageIds?.length &&
        !runtimeRules.branches?.length;
      const branchIncompatible = !!runtimeRules?.branches?.length;
      if (rulesStatus !== "valid" || broad || branchIncompatible)
        eligibilityReview.push({
          promotionId: p.id,
          active: p.is_active,
          rulesStatus,
          automaticWithoutAudienceRestrictions: broad,
          packageBranchContextIncompatible: branchIncompatible,
          hasRuleUsageLimits:
            runtimeRules?.maxGlobalUses != null ||
            runtimeRules?.maxUsesPerUser != null,
        });
      bounded(
        eligibilityReview.length,
        INVENTORY_LIMITS.anomalyGroups,
        "Eligibility review",
      );
      if (rules.success)
        for (const id of rules.data.packageIds ?? []) {
          const pkg = packagesById.get(id);
          packageReferences.push({
            promotionId: p.id,
            packageId: id,
            state: !pkg ? "missing" : pkg.is_active ? "active" : "inactive",
          });
          bounded(
            packageReferences.length,
            INVENTORY_LIMITS.packageReferences,
            "Package reference",
          );
          if (!pkg) categories.push("deleted_package_reference");
          else if (!pkg.is_active)
            categories.push("inactive_package_reference");
        }
      if (attached.some((c) => c.code !== c.code.trim().toUpperCase()))
        categories.push("noncanonical_code");
      if (
        attached.some(
          (c) => (normalized.get(c.code.trim().toUpperCase())?.length ?? 0) > 1,
        )
      )
        categories.push("normalized_code_collision");
      if (attached.some((c) => c.current_uses !== c.actual_uses))
        categories.push("counter_history_discrepancy");
      if (categories.length)
        issues.push({
          promotionId: p.id,
          active: p.is_active,
          categories: [...new Set(categories)],
          codeIds: attached.map((c) => c.id),
          redemptions: attached.reduce((n, c) => n + c.actual_uses, 0),
        });
    }
    const ownership = (
      await client.query(`select r.promotion_id,r.promotion_code_id,c.promotion_id current_owner,count(*)::int redemptions
   from promotion_redemptions r join promotion_codes c on c.id=r.promotion_code_id where r.promotion_id<>c.promotion_id
   group by r.promotion_id,r.promotion_code_id,c.promotion_id order by r.promotion_id,r.promotion_code_id limit 10001`)
    ).rows;
    bounded(
      ownership.length,
      INVENTORY_LIMITS.anomalyGroups,
      "Ownership anomaly",
    );
    const purchaseCounts = (
      await client.query(
        `select count(*)::int redemptions,count(distinct promotion_id)::int promotions_with_redemptions,count(distinct promotion_code_id)::int referenced_code_ids,count(*) filter(where package_order_id is not null)::int package_redemptions,count(*) filter(where booking_id is not null)::int class_redemptions from promotion_redemptions`,
      )
    ).rows[0];
    const reconciliation = (
      await client.query(`with sums as (
      select package_order_id,booking_id,sum(discount_amount::numeric) redemption_discount
      from promotion_redemptions group by package_order_id,booking_id
    ) select s.package_order_id,s.booking_id,p.id payment_record_id,
      s.redemption_discount,p.discount_amount_minor finance_discount_minor
      from sums s join payment_records p on
        (p.flow_type='package_purchase' and p.package_order_id=s.package_order_id)
        or (p.flow_type='single_class_booking' and p.booking_id=s.booking_id)
      where round(s.redemption_discount*100)<>p.discount_amount_minor
      order by p.id limit 10001`)
    ).rows;
    bounded(
      reconciliation.length,
      INVENTORY_LIMITS.anomalyGroups,
      "Discount reconciliation anomaly",
    );
    const dates = (
      await client.query(
        `select count(*) filter(where is_active and start_date>now())::int scheduled,count(*) filter(where end_date<now())::int expired,count(*) filter(where not is_active)::int inactive from promotions`,
      )
    ).rows[0];
    const collisions = [...normalized.entries()]
      .filter(([, v]) => v.length > 1)
      .map(([, v], index) => ({
        group: index + 1,
        codeIds: v.map((c) => c.id),
        promotionIds: [...new Set(v.map((c) => c.promotion_id))],
      }));
    bounded(
      collisions.length,
      INVENTORY_LIMITS.anomalyGroups,
      "Normalization collision group",
    );
    bounded(issues.length, INVENTORY_LIMITS.anomalyGroups, "Promotion anomaly");
    const counterDiscrepancies = codes
      .filter((c) => c.current_uses !== c.actual_uses)
      .map((c) => ({
        codeId: c.id,
        promotionId: c.promotion_id,
        stored: c.current_uses,
        actual: c.actual_uses,
      }));
    bounded(
      counterDiscrepancies.length,
      INVENTORY_LIMITS.anomalyGroups,
      "Counter discrepancy",
    );
    const result = {
      version: 2,
      limits: INVENTORY_LIMITS,
      readOnly: true,
      totals: {
        promotions: promotions.length,
        codes: codes.length,
        manual: promotions.filter((p) => p.type === "manual").length,
        automatic: promotions.filter((p) => p.type === "automatic").length,
        ...purchaseCounts,
        ...dates,
      },
      shapes,
      packageReferences,
      activeAnomalies: issues.filter((i) => i.active).length,
      anomalies: issues,
      normalizedCollisions: collisions,
      ownershipMismatches: ownership,
      discountReconciliationMismatches: reconciliation,
      counterDiscrepancies,
      eligibilityReview,
      eligibilitySummary: {
        automaticWithoutAudienceRestrictions: eligibilityReview.filter(
          (r) => r.automaticWithoutAudienceRestrictions,
        ).length,
        activeAutomaticWithoutAudienceRestrictions: eligibilityReview.filter(
          (r) => r.active && r.automaticWithoutAudienceRestrictions,
        ).length,
        packageBranchContextIncompatible: eligibilityReview.filter(
          (r) => r.packageBranchContextIncompatible,
        ).length,
        activePackageBranchContextIncompatible: eligibilityReview.filter(
          (r) => r.active && r.packageBranchContextIncompatible,
        ).length,
      },
      unusedCodeDistributionUnknown: codes.filter((c) => c.actual_uses === 0)
        .length,
      limitations: [
        "Unused does not mean undistributed. No customer identifiers or raw code strings are output.",
        "Runtime policy and Production cleanliness cannot be inferred without Owner review.",
        "Broad audience is a review flag, not proof of checkout eligibility; dates, code lookup and limits still apply.",
        "History counts are aggregates; ownership, per-customer limits and missing financial counterparts require separately reviewed evidence.",
      ],
    };
    // Validate the exact output before COMMIT and before emitting any success.
    serializeInventory(result);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (!process.argv.includes("--approved-read-only-inventory"))
      throw new InventorySafetyError(
        "Separate Owner authorization and --approved-read-only-inventory are required",
      );
    const connection = process.env.PROMOTIONS_INVENTORY_DATABASE_URL;
    if (!connection)
      throw new InventorySafetyError(
        "Set the explicitly authorized read-only inventory connection through the approved secret mechanism",
      );
    process.stdout.write(
      serializeInventory(await inventoryPromotions(connection)),
    );
  } catch (error) {
    process.stderr.write(inventoryFailureMessage(error) + "\n");
    process.exitCode = 1;
  }
}
