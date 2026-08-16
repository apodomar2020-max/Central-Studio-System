/**
 * Notifications Wave 5 — Notification Delivery Logs (System → Logs →
 * Notification Delivery) query layer.
 *
 * Operational, read-only visibility into Push delivery outcomes for
 * system/automation-originated notifications (bookings, reminders,
 * attendance, Ballet lifecycle, package events, …), with manual Admin
 * campaign deliveries also visible for completeness and clearly labeled
 * (Source = Manual Admin) — never a second campaign-management surface;
 * that stays Marketing → Manual Push Notifications.
 *
 * ─── Row granularity (investigated, not guessed) ──────────────────────────
 * The base table is `notifications`, LEFT JOINed to `notification_delivery_logs`
 * on notification_id — NOT the reverse (delivery_logs as the FROM table).
 * Two options were considered:
 *   A. one row per notification_delivery_logs row (delivery_logs as FROM)
 *   B. one row per (notification, student) aggregate with expandable
 *      per-device attempts
 * Neither alone is correct here. sendPushNotification() (lib/pushNotifications.ts)
 * reliably writes a `status: "skipped"` delivery log (errorCode
 * "no_active_device" / "push_disabled") whenever an individual-student send
 * has nothing to attempt — so option A would already surface most
 * no-device/push-disabled cases correctly. But sendBroadcastPushNotification()
 * (target="all") returns early with NO delivery log at all when push is
 * globally disabled, and any notification created with `dispatchPush: false`
 * or from before this logging existed also has zero delivery_logs rows.
 * Under option A, every one of those notifications would be silently absent
 * from this workspace — exactly the risk the task warned against. Option B's
 * expandable-aggregate UI was rejected too: platform/provider/errorCode are
 * inherently per-device-attempt attributes (not really aggregate-able
 * without picking a "primary" attempt anyway), and in this schema a student
 * realistically has 0-2 active devices, so an expand/collapse affordance adds
 * UI state for a case that is the exception, not the rule.
 * The LEFT JOIN used here gets both properties for free: a notification with
 * N delivery attempts naturally produces N rows (never hidden, never
 * artificially collapsed — each still carries its own real platform/
 * provider/status), and a notification with ZERO delivery attempts still
 * produces exactly one row, with status computed as the explicit,
 * non-fabricated literal "no_delivery_record" — never a guessed sent/failed/
 * skipped value.
 *
 * ─── Privacy ────────────────────────────────────────────────────────────
 * Every exported query function selects an explicit, named column list —
 * never `.select()` / a spread of a joined row. `notification_devices.
 * push_token` and `unregister_secret_hash` are never referenced anywhere in
 * this file. `notification_devices.device_id` (the persistent installation
 * identifier) is never selected either — the only device identifier this
 * file ever returns is `notification_devices.id`, the internal auto-
 * increment record id, and only in the single-record detail lookup (not the
 * list), since the list view has no operational need for it.
 */
import { and, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  notificationCampaignsTable,
  notificationDeliveryLogsTable,
  notificationDevicesTable,
  notificationsTable,
  studentsTable,
} from "@workspace/db";

export const NOTIFICATION_DELIVERY_STATUS_VALUES = [
  "sent",
  "failed",
  "skipped",
  "queued",
  "no_delivery_record",
] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUS_VALUES)[number];

// notifications.source is a nullable free-text column (Wave 1, migration
// 0103) — every row created going forward sets one of these three; NULL is
// reserved for genuinely historical rows and is surfaced as "legacy" below,
// never guessed at.
export const NOTIFICATION_SOURCE_FILTER_VALUES = ["manual_admin", "system", "automation", "legacy"] as const;
export type NotificationSourceFilter = (typeof NOTIFICATION_SOURCE_FILTER_VALUES)[number];

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const FILTER_OPTIONS_LIMIT = 200;

// ─── Derived SQL expressions (shared by list + count + detail) ────────────

/**
 * The Push-addressable recipient student id for this row. Prefers the
 * delivery log's own student_id (set at send time); falls back to parsing
 * `notifications.target` ("student:{id}") only when no delivery log exists
 * at all — i.e. exactly the zero-attempt case this workspace must still
 * surface. Never trusts `target` over a real delivery_logs.student_id.
 */
const recipientStudentIdExpr = sql<number | null>`
  coalesce(
    ${notificationDeliveryLogsTable.studentId},
    case when ${notificationsTable.target} ~ '^student:[0-9]+$'
      then substring(${notificationsTable.target} from 'student:([0-9]+)')::integer
      else null
    end
  )
`;

/** When this row happened: the delivery attempt's own timestamp, falling back to the notification's creation time for the no-attempt case. */
const whenExpr = sql<string>`coalesce(${notificationDeliveryLogsTable.createdAt}, ${notificationsTable.createdAt})`;

/** Explicit "no_delivery_record" literal — never a fabricated sent/failed/skipped guess. */
const statusExpr = sql<string>`coalesce(${notificationDeliveryLogsTable.status}, 'no_delivery_record')`;

/** Composite row id: real delivery_logs.id when one exists, else a synthetic per-notification id. Stable, unique, round-trips through the detail endpoint. */
const rowIdExpr = sql<string>`
  case when ${notificationDeliveryLogsTable.id} is not null
    then 'dl:' || ${notificationDeliveryLogsTable.id}::text
    else 'notif:' || ${notificationsTable.id}::text
  end
`;

// Explicit, safe row projection — every field named individually. No
// push_token, no unregister_secret_hash, no raw device installation id, no
// provider request bodies. Recipient identity is limited to name + email
// (both already permission-gated by this endpoint's RBAC — see the route).
const SAFE_ROW_SELECTION = {
  rowId: rowIdExpr,
  when: whenExpr,
  notificationId: notificationsTable.id,
  title: notificationsTable.title,
  type: notificationsTable.type,
  source: notificationsTable.source,
  relatedEntityType: notificationsTable.relatedEntityType,
  relatedEntityId: notificationsTable.relatedEntityId,
  notificationCreatedAt: notificationsTable.createdAt,
  recipientStudentId: recipientStudentIdExpr,
  recipientName: studentsTable.name,
  recipientEmail: studentsTable.email,
  deliveryLogId: notificationDeliveryLogsTable.id,
  status: statusExpr,
  platform: notificationDevicesTable.platform,
  provider: notificationDeliveryLogsTable.provider,
  channel: notificationDeliveryLogsTable.channel,
  errorCode: notificationDeliveryLogsTable.errorCode,
  errorMessage: notificationDeliveryLogsTable.errorMessage,
  sentAt: notificationDeliveryLogsTable.sentAt,
  campaignId: notificationCampaignsTable.id,
  campaignTitle: notificationCampaignsTable.title,
} as const;

export interface NotificationDeliveryListFilters {
  page?: number;
  limit?: number;
  search?: string;
  source?: string;
  status?: string;
  type?: string;
  platform?: string;
  relatedEntityType?: string;
  errorCode?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
}

function buildConditions(filters: NotificationDeliveryListFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.source) {
    conditions.push(
      filters.source === "legacy"
        ? isNull(notificationsTable.source)
        : eq(notificationsTable.source, filters.source),
    );
  }

  if (filters.status) {
    conditions.push(
      filters.status === "no_delivery_record"
        ? isNull(notificationDeliveryLogsTable.id)
        : eq(notificationDeliveryLogsTable.status, filters.status),
    );
  }

  if (filters.type) conditions.push(eq(notificationsTable.type, filters.type));
  if (filters.platform) conditions.push(eq(notificationDevicesTable.platform, filters.platform));
  if (filters.relatedEntityType) conditions.push(eq(notificationsTable.relatedEntityType, filters.relatedEntityType));
  if (filters.errorCode) conditions.push(eq(notificationDeliveryLogsTable.errorCode, filters.errorCode));

  if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)) {
    conditions.push(sql`${whenExpr} >= ${`${filters.from}T00:00:00.000Z`}`);
  }
  if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)) {
    conditions.push(sql`${whenExpr} <= ${`${filters.to}T23:59:59.999Z`}`);
  }

  if (filters.search) {
    const trimmed = filters.search.trim();
    const pattern = `%${trimmed}%`;
    const textCondition = or(
      ilike(notificationsTable.title, pattern),
      ilike(studentsTable.name, pattern),
      ilike(studentsTable.email, pattern),
    );
    const numeric = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
    const searchCondition = numeric != null
      ? or(
          textCondition,
          eq(notificationsTable.id, numeric),
          eq(notificationDeliveryLogsTable.id, numeric),
          eq(notificationsTable.relatedEntityId, numeric),
        )
      : textCondition;
    if (searchCondition) conditions.push(searchCondition);
  }

  return conditions;
}

export interface NotificationDeliveryListResult {
  data: Array<{
    id: string;
    when: string;
    notificationId: number;
    title: string;
    type: string | null;
    source: string | null;
    relatedEntityType: string | null;
    relatedEntityId: number | null;
    recipient: { studentId: number; name: string | null; email: string | null } | null;
    status: string;
    platform: string | null;
    provider: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    sentAt: string | null;
    campaign: { id: number; title: string } | null;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /**
   * Compact operational metrics for the CURRENT filtered query — one extra
   * GROUP BY status query reusing the identical join/where shape as the
   * count/page queries (same index, single pass), not a separate analytics
   * pipeline. successRate is sent / (sent + failed) among rows that were
   * actually attempted — skipped and no_delivery_record rows never had an
   * attempt to succeed or fail, so they are excluded from the rate itself
   * (they still count toward `attempts` as a total-row figure? No — see
   * `attempts` doc below for the precise definition).
   */
  metrics: {
    /** Every row in the current filter, regardless of status. */
    total: number;
    sent: number;
    failed: number;
    /** skipped + queued combined — both mean "no outcome yet/no attempt made", distinguished by their own status value in the row data. */
    skipped: number;
    /** Rows with no delivery_logs row at all (status computed as "no_delivery_record"). */
    noDeliveryRecord: number;
    /** sent / (sent + failed), rounded to whole percent; null when sent+failed is 0 (nothing to rate). */
    successRate: number | null;
  };
}

function toListRow(row: Record<string, unknown>): NotificationDeliveryListResult["data"][number] {
  const r = row as {
    rowId: string; when: string; notificationId: number; title: string; type: string | null;
    source: string | null; relatedEntityType: string | null; relatedEntityId: number | null;
    recipientStudentId: number | null; recipientName: string | null; recipientEmail: string | null;
    status: string; platform: string | null; provider: string | null; errorCode: string | null;
    errorMessage: string | null; sentAt: string | null; campaignId: number | null; campaignTitle: string | null;
  };
  return {
    id: r.rowId,
    when: r.when,
    notificationId: r.notificationId,
    title: r.title,
    type: r.type,
    source: r.source,
    relatedEntityType: r.relatedEntityType,
    relatedEntityId: r.relatedEntityId,
    recipient: r.recipientStudentId != null
      ? { studentId: r.recipientStudentId, name: r.recipientName, email: r.recipientEmail }
      : null,
    status: r.status,
    platform: r.platform,
    provider: r.provider,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    sentAt: r.sentAt,
    campaign: r.campaignId != null ? { id: r.campaignId, title: r.campaignTitle ?? "" } : null,
  };
}

export async function listNotificationDeliveryLogs(
  filters: NotificationDeliveryListFilters,
): Promise<NotificationDeliveryListResult> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
  const conditions = buildConditions(filters);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // COUNT(*) and a GROUP BY status count both reuse the identical
  // join/where shape as the page query, run in parallel with it — never
  // materializes every matching row just to count/aggregate them (mirrors
  // the existing admin_activity_logs pattern, extended with one more
  // cheap aggregate query for the compact metrics strip).
  const [[realTotals], statusCounts, data] = await Promise.all([
    db
      .select({ total: count() })
      .from(notificationsTable)
      .leftJoin(notificationDeliveryLogsTable, eq(notificationDeliveryLogsTable.notificationId, notificationsTable.id))
      .leftJoin(notificationDevicesTable, eq(notificationDevicesTable.id, notificationDeliveryLogsTable.deviceId))
      .leftJoin(studentsTable, eq(studentsTable.id, recipientStudentIdExpr))
      .where(whereClause),
    db
      .select({ status: statusExpr, statusCount: count() })
      .from(notificationsTable)
      .leftJoin(notificationDeliveryLogsTable, eq(notificationDeliveryLogsTable.notificationId, notificationsTable.id))
      .leftJoin(notificationDevicesTable, eq(notificationDevicesTable.id, notificationDeliveryLogsTable.deviceId))
      .leftJoin(studentsTable, eq(studentsTable.id, recipientStudentIdExpr))
      .where(whereClause)
      .groupBy(statusExpr),
    db
      .select(SAFE_ROW_SELECTION)
      .from(notificationsTable)
      .leftJoin(notificationDeliveryLogsTable, eq(notificationDeliveryLogsTable.notificationId, notificationsTable.id))
      .leftJoin(notificationDevicesTable, eq(notificationDevicesTable.id, notificationDeliveryLogsTable.deviceId))
      .leftJoin(studentsTable, eq(studentsTable.id, recipientStudentIdExpr))
      .leftJoin(notificationCampaignsTable, eq(notificationCampaignsTable.notificationId, notificationsTable.id))
      .where(whereClause)
      .orderBy(desc(whenExpr), desc(notificationsTable.id), desc(notificationDeliveryLogsTable.id))
      .limit(limit)
      .offset((page - 1) * limit),
  ]);

  const total = Number(realTotals?.total ?? 0);
  const byStatus = new Map(statusCounts.map((r) => [r.status, Number(r.statusCount)]));
  const sent = byStatus.get("sent") ?? 0;
  const failed = byStatus.get("failed") ?? 0;
  const skipped = (byStatus.get("skipped") ?? 0) + (byStatus.get("queued") ?? 0);
  const noDeliveryRecord = byStatus.get("no_delivery_record") ?? 0;
  const attemptedTotal = sent + failed;

  return {
    data: data.map(toListRow),
    total,
    page,
    limit,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    metrics: {
      total,
      sent,
      failed,
      skipped,
      noDeliveryRecord,
      successRate: attemptedTotal === 0 ? null : Math.round((sent / attemptedTotal) * 100),
    },
  };
}

export async function getNotificationDeliveryFilterOptions(): Promise<{ types: string[]; relatedEntityTypes: string[] }> {
  const [types, relatedEntityTypes] = await Promise.all([
    db
      .selectDistinct({ type: notificationsTable.type })
      .from(notificationsTable)
      .where(sql`${notificationsTable.type} is not null`)
      .orderBy(notificationsTable.type)
      .limit(FILTER_OPTIONS_LIMIT),
    db
      .selectDistinct({ relatedEntityType: notificationsTable.relatedEntityType })
      .from(notificationsTable)
      .where(sql`${notificationsTable.relatedEntityType} is not null`)
      .orderBy(notificationsTable.relatedEntityType)
      .limit(FILTER_OPTIONS_LIMIT),
  ]);
  return {
    types: types.map((r) => r.type).filter((t): t is string => t != null),
    relatedEntityTypes: relatedEntityTypes.map((r) => r.relatedEntityType).filter((t): t is string => t != null),
  };
}

export interface NotificationDeliveryDetail {
  notification: {
    id: number;
    title: string;
    body: string;
    type: string | null;
    source: string | null;
    createdAt: string;
    sentAt: string | null;
  };
  recipient: { studentId: number; name: string | null; email: string | null } | null;
  delivery: {
    id: number | null;
    status: string;
    platform: string | null;
    provider: string | null;
    channel: string | null;
    /**
     * Internal notification_devices.id (auto-increment record id) — never
     * the persistent installation identifier (notification_devices.device_id)
     * and never the push token. Operationally useful to tell whether two
     * delivery attempts for this student hit the same physical device
     * registration, without exposing anything that could itself be used to
     * send a Push message.
     */
    deviceRecordId: number | null;
    providerMessageId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    sentAt: string | null;
    createdAt: string | null;
  };
  context: { relatedEntityType: string | null; relatedEntityId: number | null };
  campaign: { id: number; title: string } | null;
}

export async function getNotificationDeliveryLogDetail(rowId: string): Promise<NotificationDeliveryDetail | null> {
  const dlMatch = /^dl:(\d+)$/.exec(rowId);
  const notifMatch = /^notif:(\d+)$/.exec(rowId);
  if (!dlMatch && !notifMatch) return null;

  const whereClause = dlMatch
    ? eq(notificationDeliveryLogsTable.id, Number(dlMatch[1]))
    : and(eq(notificationsTable.id, Number(notifMatch![1])), isNull(notificationDeliveryLogsTable.id));

  const [row] = await db
    .select({
      notificationId: notificationsTable.id,
      title: notificationsTable.title,
      body: notificationsTable.body,
      type: notificationsTable.type,
      source: notificationsTable.source,
      notificationCreatedAt: notificationsTable.createdAt,
      notificationSentAt: notificationsTable.sentAt,
      relatedEntityType: notificationsTable.relatedEntityType,
      relatedEntityId: notificationsTable.relatedEntityId,
      recipientStudentId: recipientStudentIdExpr,
      recipientName: studentsTable.name,
      recipientEmail: studentsTable.email,
      deliveryLogId: notificationDeliveryLogsTable.id,
      status: statusExpr,
      platform: notificationDevicesTable.platform,
      provider: notificationDeliveryLogsTable.provider,
      channel: notificationDeliveryLogsTable.channel,
      deviceRecordId: notificationDevicesTable.id,
      providerMessageId: notificationDeliveryLogsTable.providerMessageId,
      errorCode: notificationDeliveryLogsTable.errorCode,
      errorMessage: notificationDeliveryLogsTable.errorMessage,
      deliverySentAt: notificationDeliveryLogsTable.sentAt,
      deliveryCreatedAt: notificationDeliveryLogsTable.createdAt,
      campaignId: notificationCampaignsTable.id,
      campaignTitle: notificationCampaignsTable.title,
    })
    .from(notificationsTable)
    .leftJoin(notificationDeliveryLogsTable, eq(notificationDeliveryLogsTable.notificationId, notificationsTable.id))
    .leftJoin(notificationDevicesTable, eq(notificationDevicesTable.id, notificationDeliveryLogsTable.deviceId))
    .leftJoin(studentsTable, eq(studentsTable.id, recipientStudentIdExpr))
    .leftJoin(notificationCampaignsTable, eq(notificationCampaignsTable.notificationId, notificationsTable.id))
    .where(whereClause)
    .limit(1);

  if (!row) return null;

  return {
    notification: {
      id: row.notificationId,
      title: row.title,
      body: row.body,
      type: row.type,
      source: row.source,
      createdAt: row.notificationCreatedAt,
      sentAt: row.notificationSentAt,
    },
    recipient: row.recipientStudentId != null
      ? { studentId: row.recipientStudentId, name: row.recipientName, email: row.recipientEmail }
      : null,
    delivery: {
      id: row.deliveryLogId,
      status: row.status,
      platform: row.platform,
      provider: row.provider,
      channel: row.channel,
      deviceRecordId: row.deviceRecordId,
      providerMessageId: row.providerMessageId,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      sentAt: row.deliverySentAt,
      createdAt: row.deliveryCreatedAt,
    },
    context: { relatedEntityType: row.relatedEntityType, relatedEntityId: row.relatedEntityId },
    campaign: row.campaignId != null ? { id: row.campaignId, title: row.campaignTitle ?? "" } : null,
  };
}
