import { createHash } from "node:crypto";
import type { TransferGroup } from "./types";

export const MANIFEST_VERSION = "g1r-v1";

const transfer = (
  key: string,
  table: string,
  order: number,
  scope: TransferGroup["scope"],
  dependencies: string[] = [],
  excludedColumns: string[] = [],
): TransferGroup => ({
  key, table, order, scope, dependencies, excludedColumns,
  classification: "transfer",
  stableId: order === 0 ? "singleton" : "preserve",
  sequence: order === 0 ? "none" : "advance",
  explanation: "Approved launch configuration; transactional children are separate manifest groups.",
});
const classify = (
  classification: "exclude" | "decision_required",
  table: string,
  scope: TransferGroup["scope"],
  explanation: string,
): TransferGroup => ({
  key: table, table, order: 999, scope, dependencies: [], classification,
  stableId: "preserve", sequence: "none", explanation,
});

export const freshLaunchConfigurationManifest: readonly TransferGroup[] = [
  transfer("danceTypes", "dance_types", 10, "general_studio"),
  transfer("instructors", "instructors", 20, "general_studio"),
  transfer("classes", "classes", 30, "general_studio", ["danceTypes", "instructors"]),
  transfer("schedules", "schedules", 40, "general_studio", ["classes"]),
  transfer("pricePackages", "price_packages", 30, "general_studio"),
  transfer("pricePackageDanceTypes", "price_package_dance_types", 40, "general_studio", ["pricePackages", "danceTypes"]),
  transfer("classPricingSettings", "class_pricing_settings", 0, "general_studio"),
  transfer("classCapacitySettings", "class_capacity_settings", 0, "general_studio", [], ["updated_by_admin_id"]),
  transfer("classReminderSettings", "class_reminder_settings", 0, "general_studio", [], ["updated_by_admin_id"]),
  transfer("backgroundMusicSettings", "background_music_settings", 0, "shared", [], ["updated_by_admin_id"]),
  transfer("roles", "roles", 10, "shared"),
  transfer("promotions", "promotions", 30, "general_studio"),
  transfer("promotionCodes", "promotion_codes", 40, "general_studio", ["promotions"]),
  transfer("heroItems", "hero_items", 10, "shared"),
  transfer("appContentPages", "app_content_pages", 10, "shared", [], ["updated_by"]),
  // Order 5, strictly before appFaqItems' order 10 — categories must transfer
  // first so app_faq_items.category_id resolves against an already-imported
  // parent row (literal-ID preservation, same model as dance_types).
  transfer("appFaqCategories", "app_faq_categories", 5, "shared"),
  transfer("appFaqItems", "app_faq_items", 10, "shared", ["appFaqCategories"]),
  transfer("balletLevels", "ballet_levels", 10, "ballet"),
  transfer("balletInstructors", "ballet_instructors", 10, "ballet"),
  transfer("balletGroups", "ballet_groups", 20, "ballet", ["balletLevels"]),
  transfer("balletClasses", "ballet_classes", 30, "ballet", ["balletLevels", "balletGroups", "balletInstructors"]),
  transfer("balletClassLevels", "ballet_class_levels", 40, "ballet", ["balletClasses", "balletLevels"]),
  transfer("balletClassGroups", "ballet_class_groups", 40, "ballet", ["balletClasses", "balletGroups"]),
  transfer("balletSchedules", "ballet_schedules", 40, "ballet", ["balletClasses"]),
  transfer("balletGroupSchedules", "ballet_group_schedules", 50, "ballet", ["balletGroups", "balletSchedules"]),
  transfer("balletPackages", "ballet_packages", 20, "ballet"),
  transfer("balletPackageLevels", "ballet_package_levels", 30, "ballet", ["balletPackages", "balletLevels"]),
  transfer("balletFaqs", "ballet_faqs", 10, "ballet"),
  transfer("balletProgramRequirementSections", "ballet_program_requirement_sections", 10, "ballet"),
  transfer("balletProgramRequirementItems", "ballet_program_requirement_items", 20, "ballet", ["balletProgramRequirementSections"]),
  transfer("balletPerformanceOpportunities", "ballet_performance_opportunities", 10, "ballet"),

  ...["package_orders", "credit_transactions", "bookings", "attendance", "payment_records",
    "payment_events", "payment_refunds", "promotion_redemptions", "notifications",
    "notification_read_receipts", "notification_devices", "notification_delivery_logs",
    "ballet_applications", "ballet_application_events",
    "ballet_level_assignments", "ballet_enrollment_cancellation_requests",
    "ballet_payments", "ballet_refunds", "marketing_campaign_recipients",
    "marketing_delivery_logs", "marketing_opt_ins", "feedback", "student_dance_interests",
    "reminder_worker_heartbeats"].map((table) =>
    classify("exclude", table, table.startsWith("ballet_") ? "ballet" : "general_studio", "Operational or financial transaction.")),

  ...["students", "children", "system_users", "admin_activity_logs", "promotion_audit_logs",
    "payment_backfill_batches", "payment_backfill_progress", "payment_backfill_progress_items",
    "report_jobs", "app_contact_links", "ballet_settings", "notification_templates", "marketing_campaigns",
    "instagram_token", "email_otps", "marketing_templates", "class_whatsapp_groups"].map((table) =>
    classify("decision_required", table, "mixed", "Identity, audit, credential, PII, or unclear retention boundary; excluded by default.")),
];

export function canonicalManifestJson(): string {
  return JSON.stringify([...freshLaunchConfigurationManifest].sort((a, b) => a.key.localeCompare(b.key)));
}

export const MANIFEST_HASH = createHash("sha256").update(canonicalManifestJson()).digest("hex");

export function validateManifest(): void {
  const keys = new Set<string>();
  const tables = new Set<string>();
  for (const group of freshLaunchConfigurationManifest) {
    if (keys.has(group.key)) throw new Error(`DUPLICATE_MANIFEST_KEY:${group.key}`);
    if (tables.has(group.table)) throw new Error(`DUPLICATE_MANIFEST_TABLE:${group.table}`);
    keys.add(group.key);
    tables.add(group.table);
  }
  for (const group of freshLaunchConfigurationManifest.filter((entry) => entry.classification === "transfer")) {
    for (const dependency of group.dependencies) {
      const parent = freshLaunchConfigurationManifest.find((entry) => entry.key === dependency);
      if (!parent || parent.classification !== "transfer" || parent.order > group.order) {
        throw new Error(`INVALID_MANIFEST_DEPENDENCY:${group.key}:${dependency}`);
      }
    }
  }
}
